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
  if (!Hls.isSupported()) {
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.addEventListener("loadedmetadata", () => video.play());
    } else {
      art.notice.show = "Unsupported playback format: m3u8";
    }
    return;
  }

  const hls = new Hls({
    enableWorker:            true,
    maxBufferLength:         30,
    maxMaxBufferLength:      600,
    maxBufferSize:           60 * 1000 * 1000,
    maxBufferHole:           0.5,
    lowBufferWatchdogPeriod: 2,
    highBufferWatchdogPeriod:5,
    liveSyncDurationCount:   2,
    liveMaxLatencyDurationCount: 3,
    fragLoadingTimeOut:      20000,
    fragLoadingMaxRetry:     6,
    fragLoadingRetryDelay:   1000,
    fragLoadingMaxRetryTimeout: 64000,
    startPosition:           -1,
    capLevelOnFPSDrop:       true,
    abrEwmaFastLive:         3.0,
    abrEwmaSlowLive:         9.0,
    abrEwmaDefaultEstimate:  500000,
    enableSoftwareAES:       true,
    nudgeOffset:             0.1,
    nudgeMaxRetry:           3,
    maxStarvationDelay:      4,
  });

  art.hls = hls;
  hls.loadSource(url);
  hls.attachMedia(video);

  // lock audio track to avoid mid-stream level changes
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    hls.autoLevelEnabled = true;
  });

  // error recovery
  hls.on(Hls.Events.ERROR, (evt, data) => {
    const { type, details, fatal } = data;
    console.warn("HLS error", type, details, "fatal=", fatal);
    if (!fatal) return;

    switch (type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        hls.startLoad();
        break;
      case Hls.ErrorTypes.MEDIA_ERROR:
        hls.recoverMediaError();
        break;
      default:
        hls.destroy();
    }
  });

  art.once("destroy", () => hls.destroy());
}
