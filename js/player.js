var art;

$(document).ready(function () {
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  const videoUrl = params.get("video_url");
  const subtitleUrl = params.get("subtitle_url");

  if (!videoUrl) {
    $(".player").html(
      "No video URL found in the URL hash. Append #video_url=YOUR_URL to the current URL."
    );
    return;
  }

  (async () => {
    let subtitles = [];
    if (subtitleUrl) {
      try {
        subtitles = await fetchSubtitleTracks(subtitleUrl);
      } catch (err) {
        console.error("Failed to load subtitles from hash:", err);
      }
    }

    playVideo(videoUrl, subtitles);
  })();
});

// -----------------------------
// helpers
// -----------------------------
function parseAttributes(attrString) {
  const re = /([A-Z0-9\-]+)=(\"(?:[^\"\\]|\\.)*\"|[^,]*)/g;
  const attrs = {};
  let m;

  while ((m = re.exec(attrString))) {
    let [, key, val] = m;
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    attrs[key] = val;
  }

  return attrs;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, ms = 15000, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      ...opts,
      signal: ac.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response;
  } finally {
    clearTimeout(t);
  }
}

async function normalizeVtt(url) {
  const res = await fetch(url);
  let text = await res.text();

  if (/^\d+\r?\n\d{2}:\d{2}:\d{2},/.test(text)) {
    text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
    text = text.replace(/^\d+\r?\n/gm, "");
    text = "WEBVTT\n\n" + text;
  }

  const blob = new Blob([text], { type: "text/vtt" });
  return URL.createObjectURL(blob);
}

// only used for manifest/index.m3u8
// waits up to 15s for fetch response
// retries only after 15s
async function ensureManifest(url, maxTries = 7) {
  let attempt = 1;

  while (attempt <= maxTries) {
    try {
      return await fetchWithTimeout(url, 15000, { method: "GET" });
    } catch (err) {
      if (attempt >= maxTries) {
        throw err;
      }

      console.warn(
        `[manifest] attempt ${attempt}/${maxTries} failed, retrying in 15 seconds...`,
        err
      );

      attempt++;
      await sleep(15000);
    }
  }
}

// -----------------------------
// subtitles
// -----------------------------
async function fetchSubtitleTracks(m3u8Url) {
  const res = await fetch(m3u8Url);
  const txt = await res.text();
  const lines = txt.split(/\r?\n/);
  const tracks = [];
  let pending = null;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-MEDIA") && line.includes("TYPE=SUBTITLES")) {
      const attrs = parseAttributes(line.substring(line.indexOf(":") + 1));
      pending = {
        name: attrs.NAME || attrs.LANGUAGE,
        def: attrs.DEFAULT === "YES",
      };
    } else if (pending && line.trim() && !line.startsWith("#")) {
      const uri = new URL(line.trim(), m3u8Url).href;

      tracks.push({
        name: pending.name,
        url: await normalizeVtt(uri),
        def: pending.def,
        type: "vtt",
      });

      pending = null;
    }
  }

  return tracks;
}

// -----------------------------
// player
// -----------------------------
async function playVideo(videoUrl, subtitles) {
  console.log(subtitles);
  art?.destroy();

  let $picker = document.getElementById("subtitleColorPicker");
  if (!$picker) {
    $picker = document.createElement("input");
    $picker.type = "color";
    $picker.id = "subtitleColorPicker";
    $picker.style.display = "none";
    document.body.appendChild($picker);

    $picker.addEventListener("input", (e) => {
      const col = e.target.value;
      art.subtitle.style({ color: col });
      art.subtitle.show = true;

      const sq = document.getElementById("subtitleColorSquare");
      if (sq) sq.style.background = col;
    });
  }

  const subtitleSetting = {
    width: 280,
    html: "Subtitle",
    tooltip: subtitles.find((s) => s.def)?.name || "Off",
    icon: '<img width="22" height="22" src="https://artplayer.org/assets/img/subtitle.svg">',
    selector: [
      { html: "Off", name: "off", default: !subtitles.some((s) => s.def) },
      ...subtitles.map((s) => ({
        html: s.name,
        name: s.name,
        default: s.def,
      })),
      {
        html:
          '<div id="subtitleColorSquare" ' +
          'style="width:20px;height:20px;border:1px solid #666;' +
          'border-radius:3px;background:#fff;"></div>',
        name: "color-picker",
        tooltip: "Pick text color",
      },
    ],
    onSelect(item) {
      if (item.name === "off") {
        art.subtitle.show = false;
      } else if (item.name === "color-picker") {
        document.getElementById("subtitleColorPicker").click();
      } else {
        const track = subtitles.find((t) => t.name === item.name);
        if (track) {
          art.subtitle.url = track.url;
          art.subtitle.show = true;
        }
      }

      return item.html;
    },
  };

  Artplayer.DBCLICK_TIME = 300;
  Artplayer.MOBILE_CLICK_PLAY = true;
  Artplayer.MOBILE_DBCLICK_PLAY = false;

  class doubleClick {
    dblclick() {
      const now = Date.now();
      const result =
        this.timestamp && now - this.timestamp <= Artplayer.DBCLICK_TIME;
      this.timestamp = now;
      return result;
    }
  }

  const ldb = new doubleClick();

  art = new Artplayer({
    container: ".player",
    url: videoUrl,
    type: "m3u8",
    title: "m3u8 player",
    isLive: false,
    muted: false,
    autoplay: false,
    pip: true,
    autoSize: false,
    autoMini: true,
    screenshot: true,
    setting: true,
    loop: true,
    flip: true,
    playbackRate: true,
    aspectRatio: true,
    fullscreen: true,
    fullscreenWeb: true,
    subtitleOffset: true,
    miniProgressBar: true,
    mutex: true,
    backdrop: true,
    playsInline: false,
    autoPlayback: true,
    airplay: true,
    theme: "#23ade5",
    thumbnails: {},
    highlight: [{ time: 15, text: "Welcome to m3u8 player" }],
    icons: {
      loading:
        '<img src="images/loading.gif" class="loading-gif" title="Video loading..." />',
    },
    customType: {
      m3u8: playM3u8,
    },
    plugins: [],
    settings: [subtitleSetting],
    layers: [
      {
        html: "",
        style: {
          position: "absolute",
          top: "50%",
          left: 0,
          transform: "translateY(-50%)",
          width: "25%",
          height: "25%",
        },
        disable: !Artplayer.utils.isMobile,
        click: function () {
          if (ldb.dblclick()) art.backward = Artplayer.SEEK_STEP;
        },
      },
      {
        html: "",
        style: {
          position: "absolute",
          top: "50%",
          right: 0,
          transform: "translateY(-50%)",
          width: "25%",
          height: "25%",
        },
        disable: !Artplayer.utils.isMobile,
        click: function () {
          if (ldb.dblclick()) art.forward = Artplayer.SEEK_STEP;
        },
      },
    ],
  });

  art.on("ready", () => {
    art.subtitle.style({
      color: "#fff",
      textShadow:
        "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000",
    });

    const defTrack = subtitles.find((s) => s.def);
    if (defTrack) {
      art.subtitle.url = defTrack.url;
      art.subtitle.show = true;
    }

    layer.msg("Start playing");
    art.play();
  });
}

// -----------------------------
// manifest-focused m3u8 loader
// -----------------------------
function playM3u8(video, url, art) {
  const MAX_TRIES = 7;
  let hls = null;

  const destroyHls = () => {
    try {
      hls && hls.destroy();
    } catch (_) {}
    hls = null;
  };

  // native safari / ios path
  if (!window.Hls || !Hls.isSupported()) {
    let nativeAttempt = 1;
    let retrying = false;

    const loadNative = async () => {
      try {
        await ensureManifest(url, MAX_TRIES - (nativeAttempt - 1));
      } catch (err) {
        console.error("[native] manifest failed after retries", err);
        art.notice.show = "Failed to load playlist.";
        return;
      }

      retrying = false;
      video.src = url;
      video.crossOrigin = "anonymous";

      if ("preservesPitch" in video) video.preservesPitch = true;
      if ("mozPreservesPitch" in video) video.mozPreservesPitch = true;
      if ("webkitPreservesPitch" in video) video.webkitPreservesPitch = true;

      video.playbackRate = 1;
      video.defaultPlaybackRate = 1;

      video.addEventListener(
        "loadedmetadata",
        () => {
          video.play().catch(() => {});
        },
        { once: true }
      );

      video.addEventListener(
        "error",
        async () => {
          if (retrying) return;
          retrying = true;

          if (nativeAttempt >= MAX_TRIES) {
            art.notice.show = "Failed to load playlist.";
            return;
          }

          nativeAttempt++;
          console.warn(
            `[native] video/manifest error, retrying in 15 seconds... (${nativeAttempt}/${MAX_TRIES})`
          );

          await sleep(15000);
          loadNative();
        },
        { once: true }
      );
    };

    loadNative();
    return;
  }

  // hls.js path
  let attemptsUsed = 0;
  let retryInProgress = false;

  const boot = async () => {
    await ensureManifest(url, Math.max(1, MAX_TRIES - attemptsUsed));

    destroyHls();

    hls = new Hls({
      manifestLoadMaxRetry: 0,
      manifestLoadingTimeOut: 15000,
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 90,
    });

    hls.attachMedia(video);
    hls.loadSource(url);

    hls.once(Hls.Events.MANIFEST_PARSED, () => {
      retryInProgress = false;

      video.playbackRate = 1;
      video.defaultPlaybackRate = 1;

      if ("preservesPitch" in video) video.preservesPitch = true;
      if ("mozPreservesPitch" in video) video.mozPreservesPitch = true;
      if ("webkitPreservesPitch" in video) video.webkitPreservesPitch = true;

      video.play().catch(() => {});
    });

    hls.on(Hls.Events.ERROR, async (_, data) => {
      if (!data) return;
      if (retryInProgress) return;
      if (data.type !== Hls.ErrorTypes.NETWORK_ERROR) return;

      const d = data.details;
      const isManifestIssue =
        d === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
        d === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
        d === Hls.ErrorDetails.MANIFEST_PARSING_ERROR;

      if (!isManifestIssue) return;

      retryInProgress = true;
      attemptsUsed++;

      if (attemptsUsed >= MAX_TRIES) {
        art.notice.show = "Failed to load playlist.";
        return;
      }

      console.warn(
        `[hls] manifest error, retrying in 15 seconds... (${attemptsUsed}/${MAX_TRIES})`,
        data
      );

      await sleep(15000);

      try {
        await ensureManifest(url, Math.max(1, MAX_TRIES - attemptsUsed));

        if (!hls) {
          retryInProgress = false;
          return;
        }

        hls.stopLoad();
        hls.loadSource(url);
        hls.startLoad(-1);
        retryInProgress = false;
      } catch (err) {
        console.warn("[hls] soft reload failed, rebuilding hls instance...", err);

        await sleep(15000);

        try {
          await boot();
        } catch (bootErr) {
          console.error("[hls] rebuild failed", bootErr);
          art.notice.show = "Failed to load playlist.";
        }
      }
    });
  };

  art.once("destroy", destroyHls);

  (async () => {
    try {
      await boot();
    } catch (err) {
      console.error("[hls] initial boot failed", err);
      art.notice.show = "Failed to load playlist.";
    }
  })();
}