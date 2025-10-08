var art;

$(document).ready(function () {
  const hash = window.location.hash.slice(1); // drop the leading ‘#’
  const params = new URLSearchParams(hash);
  const videoUrl = params.get("video_url");
  const subtitleUrl = params.get("subtitle_url");

  if (!videoUrl) {
      $(".player").html("No video URL found in the URL hash. Append #video_url=YOUR_URL to the current URL.");
      return;
  }

  // wrap the async work in an IIFE
  (async () => {
    let subtitles = [];
    if (subtitleUrl) {
      try {
        subtitles = await fetchSubtitleTracks(subtitleUrl);
      } catch (err) {
        console.error("Failed to load subtitles from hash:", err);
      }
    }
    // now start playback with an array (possibly empty)
    playVideo(videoUrl, subtitles);
  })();
});

// — helper: turn `k=v,a=b,…` into {k:v, a:b,…} —
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
async function normalizeVtt(url) {
  const res = await fetch(url);
  let text = await res.text();

  // if it looks like SRT (numeric cue IDs + commas), convert it:
  if (/^\d+\r?\n\d{2}:\d{2}:\d{2},/.test(text)) {
    // 1) replace commas in timecodes with dots
    text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
    // 2) strip out numeric cue-IDs
    text = text.replace(/^\d+\r?\n/gm, "");
    // 3) prepend VTT header
    text = "WEBVTT\n\n" + text;
  }

  // give Artplayer a blob URL it can actually parse
  const blob = new Blob([text], { type: "text/vtt" });
  return URL.createObjectURL(blob);
}

// — fetch & parse all subtitle tracks from a .m3u8 —
async function fetchSubtitleTracks(m3u8Url) {
  const res = await fetch(m3u8Url);
  const txt = await res.text();
  const lines = txt.split(/\r?\n/);
  const tracks = [];
  let pending;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-MEDIA") && line.includes("TYPE=SUBTITLES")) {
      // pick out NAME, LANGUAGE, DEFAULT
      const attrs = parseAttributes(line.substring(line.indexOf(":") + 1));
      pending = {
        name: attrs.NAME || attrs.LANGUAGE,
        def: attrs.DEFAULT === "YES",
      };
    } else if (pending && line.trim() && !line.startsWith("#")) {
      // resolve relative URI
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

    // 2) When the user picks a color, apply it
    $picker.addEventListener("input", (e) => {
      const col = e.target.value;
      art.subtitle.style({ color: col });
      art.subtitle.show = true;
      // update the square in your menu
      const sq = document.getElementById("subtitleColorSquare");
      if (sq) sq.style.background = col;
    });
  }

  // 3) Build your settings entry
  const subtitleSetting = {
    width: 280,
    html: "Subtitle",
    tooltip: subtitles.find((s) => s.def)?.name || "Off",
    icon: '<img width="22" height="22" src="https://artplayer.org/assets/img/subtitle.svg">',
    selector: [
      { html: "Off", name: "off", default: !subtitles.some((s) => s.def) },
      ...subtitles.map((s) => ({ html: s.name, name: s.name, default: s.def })),

      // color‐picker square
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
        // kick off the native picker
        document.getElementById("subtitleColorPicker").click();
      } else {
        // language selection
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
    customType: { m3u8: playM3u8 },
    plugins: [
      // artplayerPluginControl(),
      artplayerPluginHlsControl({
        control: true,
        setting: false,
        title: "Quality",
        auto: "Auto",
      }),
    ],
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
          // backgroundColor: "red",
          // color: "red",
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
          // backgroundColor: "red",
          // color: "red",
        },
        disable: !Artplayer.utils.isMobile,
        click: function () {
          if (ldb.dblclick()) art.forward = Artplayer.SEEK_STEP;
        },
      },
    ],
  });

  // 3) When ready: style + load default + play
  art.on("ready", () => {
    // white text with black outline
    art.subtitle.style({
      color: "#fff",
      textShadow:
        "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000",
    });

    // load the DEFAULT=YES track, if any
    const defTrack = subtitles.find((s) => s.def);
    if (defTrack) {
      art.subtitle.url = defTrack.url;
      art.subtitle.show = true;
    }

    layer.msg("Start playing");
    art.play();
  });
}

function playM3u8(video, url, art) {
  // Native HLS (Safari / iOS)
  if (!window.Hls || !Hls.isSupported()) {
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.crossOrigin = "anonymous";
      video.playbackRate = 1;
      if ("preservesPitch" in video) video.preservesPitch = true;
      if ("mozPreservesPitch" in video) video.mozPreservesPitch = true;
      video.src = url;
      video.addEventListener("loadedmetadata", () => video.play().catch(()=>{}));
    } else {
      art.notice.show = "Unsupported playback format: m3u8";
    }
    return;
  }

  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,         // keep it stable
    backBufferLength: 30,
    // sane buffers (don’t make tiny holes)
    maxBufferLength: 30,
    maxMaxBufferLength: 120,
    maxBufferSize: 60 * 1000 * 1000,
    // retries
    fragLoadingTimeOut: 20000,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 1000,
    fragLoadingMaxRetryTimeout: 64000,
    capLevelToPlayerSize: true,
  });

  art.hls = hls;
  hls.attachMedia(video);
  hls.loadSource(url);

  // pin state
  let pinnedAudioTrack = null;
  let pinnedLevel = null;       // index into hls.levels
  let triedLevels = new Set();

  // choose a stable audio track and a single good level, then disable ABR
  hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
    const levels = hls.levels || [];
    // pick a “good” level:
    // 1) prefer one that advertises an AAC codec (e.g., mp4a.40.2)
    // 2) else pick median bitrate to avoid extremes
    let idx = -1;
    for (let i = 0; i < levels.length; i++) {
      const ac = (levels[i].audioCodec || "").toLowerCase();
      if (ac.includes("mp4a")) { idx = i; break; }
    }
    if (idx === -1 && levels.length) idx = Math.floor(levels.length / 2);
    if (idx >= 0) {
      pinnedLevel = idx;
      triedLevels.add(idx);
      hls.autoLevelEnabled = false;   // hard-disable ABR
      if (hls.currentLevel !== idx) hls.currentLevel = idx;
    }

    // pin an audio track (prefer default/autoselect/en)
    const tracks = (data && data.audioTracks) ? data.audioTracks : (hls.audioTracks || []);
    if (tracks && tracks.length) {
      let a = tracks.findIndex(t => t.default || t.autoselect);
      if (a < 0) a = tracks.findIndex(t => (t.lang || "").toLowerCase().startsWith("en"));
      if (a < 0) a = 0;
      pinnedAudioTrack = a;
      if (hls.audioTrack !== a) hls.audioTrack = a;
    }

    // keep playback plain vanilla
    video.crossOrigin = "anonymous";
    video.playbackRate = 1;
    if ("preservesPitch" in video) video.preservesPitch = true;
    if ("mozPreservesPitch" in video) video.mozPreservesPitch = true;

    video.play().catch(()=>{});
  });

  // never allow audio track drift
  hls.on(Hls.Events.AUDIO_TRACK_SWITCHING, () => {
    if (pinnedAudioTrack != null && hls.audioTrack !== pinnedAudioTrack) {
      hls.audioTrack = pinnedAudioTrack;
    }
  });

  // never allow level drift
  hls.on(Hls.Events.LEVEL_SWITCHED, (_e, d) => {
    if (pinnedLevel != null && d.level !== pinnedLevel) {
      hls.autoLevelEnabled = false;
      hls.currentLevel = pinnedLevel;
    }
  });

  // targeted error handling: if audio parsing/demux glitches, fail over to another single level
  function failoverLevel() {
    const levels = hls.levels || [];
    if (!levels.length) return false;
    // try next best near current pinned
    for (let step = 1; step <= levels.length; step++) {
      const up = (pinnedLevel + step) % levels.length;
      if (!triedLevels.has(up)) {
        pinnedLevel = up;
        triedLevels.add(up);
        hls.autoLevelEnabled = false;
        hls.currentLevel = up;
        // re-assert audio pin shortly after
        if (pinnedAudioTrack != null) {
          setTimeout(() => { hls.audioTrack = pinnedAudioTrack; }, 250);
        }
        return true;
      }
    }
    return false;
  }

  hls.on(Hls.Events.ERROR, (_evt, data) => {
    const { type, details, fatal } = data || {};
    console.warn("[HLS ERROR]", type, details, "fatal=", fatal);

    // audio-related non-fatal issues → try level failover
    if (!fatal) {
      if (
        details === Hls.ErrorDetails.AUDIO_PARSING_ERROR ||
        details === Hls.ErrorDetails.AUDIO_TRACK_LOAD_ERROR ||
        details === Hls.ErrorDetails.AUDIO_TRACK_LOAD_TIMEOUT ||
        details === Hls.ErrorDetails.BUFFER_APPEND_ERROR ||
        details === Hls.ErrorDetails.BUFFER_APPENDING_ERROR
      ) {
        if (!failoverLevel()) {
          // as a last resort try media recover
          hls.recoverMediaError();
          if (pinnedAudioTrack != null) {
            setTimeout(() => { hls.audioTrack = pinnedAudioTrack; }, 250);
          }
        }
      }
      return;
    }

    // fatal
    switch (type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        hls.startLoad();
        break;
      case Hls.ErrorTypes.MEDIA_ERROR:
        hls.recoverMediaError();
        if (pinnedAudioTrack != null) {
          setTimeout(() => { hls.audioTrack = pinnedAudioTrack; }, 250);
        }
        break;
      default:
        try { hls.destroy(); } catch {}
        setTimeout(() => playM3u8(video, url, art), 300);
    }
  });

  // no forward nudges; they tend to break AAC
  hls.on(Hls.Events.BUFFER_STALLED, () => {
    if (!video.seeking) {
      const t = video.currentTime;
      video.currentTime = Math.max(0, t - 0.05); // gentle back seek only
    }
  });

  art.once("destroy", () => { try { hls.destroy(); } catch {} });
}

