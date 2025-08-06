let demo_video_url = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

var art;
var video_url = "",
  subtitle_url = "";

$(document).ready(function () {
  const hash       = window.location.hash.slice(1); // drop the leading ‘#’
  const params     = new URLSearchParams(hash);
  const videoUrl   = params.get('video_url');
  const subtitleUrl= params.get('subtitle_url');

  if (!videoUrl) return;

  // wrap the async work in an IIFE
  (async () => {
    let subtitles = [];
    if (subtitleUrl) {
      try {
        subtitles = await fetchSubtitleTracks(subtitleUrl);
      } catch (err) {
        console.error('Failed to load subtitles from hash:', err);
      }
    }
    // now start playback with an array (possibly empty)
    playVideo(videoUrl, subtitles);
  })();
});

// — helper: turn `k=v,a=b,…` into {k:v, a:b,…} —
function parseAttributes(attrString) {
  const re = /([A-Z0-9\-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
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
  const res  = await fetch(url);
  let text   = await res.text();

  // if it looks like SRT (numeric cue IDs + commas), convert it:
  if (/^\d+\r?\n\d{2}:\d{2}:\d{2},/.test(text)) {
    // 1) replace commas in timecodes with dots
    text = text.replace(
      /(\d{2}:\d{2}:\d{2}),(\d{3})/g,
      '$1.$2'
    );
    // 2) strip out numeric cue-IDs
    text = text.replace(/^\d+\r?\n/gm, '');
    // 3) prepend VTT header
    text = 'WEBVTT\n\n' + text;
  }

  // give Artplayer a blob URL it can actually parse
  const blob = new Blob([text], { type: 'text/vtt' });
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

// let art;
// let video_url = "", subtitle_url = "";

$(".form-control").on("submit", async function (e) {
  e.preventDefault();

  const tmpV = $(".form-control>.url").val().trim();
  const tmpS = $(".form-control>.url1").val().trim();

  if (!tmpV) {
    layer.msg("Please enter video URL");
    return false;
  }

  if (video_url === tmpV && subtitle_url === tmpS) {
    layer.msg("URLs unchanged, resuming");
    art.play();
    return false;
  }

  layer.msg("Loading…");
  video_url    = tmpV;
  subtitle_url = tmpS;

  // 1) update the URL hash so on reload/bookmark it will auto-play
  const params = new URLSearchParams({ video_url: tmpV });
  if (tmpS) params.set("subtitle_url", tmpS);
  window.location.hash = params.toString();

  // 2) fetch subtitles if supplied
  let subtitles = [];
  if (subtitle_url) {
    try {
      subtitles = await fetchSubtitleTracks(subtitle_url);
    } catch (err) {
      console.error("subtitle load failed", err);
    }
  }

  console.log("subtitles:", subtitles);

  // 3) actually play
  await playVideo(video_url, subtitles);
});


async function playVideo(videoUrl, subtitles) {
  $(".main").removeClass("ready");
  art?.destroy();

  let $picker = document.getElementById('subtitleColorPicker');
  if (!$picker) {
    $picker = document.createElement('input');
    $picker.type = 'color';
    $picker.id   = 'subtitleColorPicker';
    $picker.style.display = 'none';
    document.body.appendChild($picker);

    // 2) When the user picks a color, apply it
    $picker.addEventListener('input', (e) => {
      const col = e.target.value;
      art.subtitle.style({ color: col });
      art.subtitle.show = true;
      // update the square in your menu
      const sq = document.getElementById('subtitleColorSquare');
      if (sq) sq.style.background = col;
    });
  }

  // 3) Build your settings entry
  const subtitleSetting = {
    width:   280,
    html:    'Subtitle',
    tooltip: subtitles.find(s=>s.def)?.name || 'Off',
    icon:    '<img width="22" height="22" src="https://artplayer.org/assets/img/subtitle.svg">',
    selector: [
      { html: 'Off', name: 'off', default: !subtitles.some(s=>s.def) },
      ...subtitles.map(s=>({ html:s.name, name:s.name, default:s.def })),

      // color‐picker square
      {
        html: '<div id="subtitleColorSquare" ' +
              'style="width:20px;height:20px;border:1px solid #666;' +
                     'border-radius:3px;background:#fff;"></div>',
        name: 'color-picker',
        tooltip: 'Pick text color'
      }
    ],
    onSelect(item) {
      if (item.name === 'off') {
        art.subtitle.show = false;
      }
      else if (item.name === 'color-picker') {
        // kick off the native picker
        document.getElementById('subtitleColorPicker').click();
      }
      else {
        // language selection
        const track = subtitles.find(t=>t.name===item.name);
        if (track) {
          art.subtitle.url  = track.url;
          art.subtitle.show = true;
        }
      }
      return item.html;
    }
  };


  // 2) Instantiate Artplayer (no multi-subtitle plugin needed)
  art = new Artplayer({
    container:      ".player",
    url:             videoUrl,
    title:           "m3u8 player",
    loop:            true,
    flip:            true,
    playbackRate:    true,
    aspectRatio:     true,
    screenshot:      true,
    setting:         true,
    pip:             true,
    fullscreenWeb:   true,
    fullscreen:      true,
    subtitleOffset:  true,
    miniProgressBar: true,
    airplay:         true,
    theme:           "#23ade5",
    thumbnails:      {},
    highlight:       [{ time: 15, text: "Welcome to m3u8 player" }],
    icons:           {
      loading:
        '<img src="images/loading.gif" width="100px" title="Video loading..." />',
    },
    customType:      { m3u8: playM3u8 },
    plugins:         [
      artplayerPluginControl(),
      artplayerPluginHlsQuality({ control:true, setting:false, title:"Quality", auto:"Auto" })
    ],
    settings:        [
      {
        html: "Control bar floating",
        icon:
          '<img width="22" height="22" src="images/state.svg">',
        switch: true,
        onSwitch: async (item) => {
          item.tooltip = item.switch ? "Close" : "Open";
          art.plugins.artplayerPluginControl.enable = !item.switch;
          await Artplayer.utils.sleep(300);
          art.setting.updateStyle();
          return !item.switch;
        },
      },
      subtitleSetting
    ],
  });

  // 3) When ready: style + load default + play
  art.on("ready", () => {
    // white text with black outline
    art.subtitle.style({
      color:      "#fff",
      textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000"
    });

    // load the DEFAULT=YES track, if any
    const defTrack = subtitles.find(s=>s.def);
    if (defTrack) {
      art.subtitle.url = defTrack.url;
      art.subtitle.show = true;
    }

    layer.msg("Start playing");
    art.play();
  });
}


function playM3u8(video, url, art) {
  if (Hls.isSupported()) {
    // 1) configure Hls.js for smoother audio/video
    const hls = new Hls({
      maxBufferLength: 30,          // try to keep 30s in buffer
      maxMaxBufferLength: 60,       // cap at 60s buffer
      maxBufferHole: 0.5,           // allow small gaps
      lowBufferWatchdogPeriod: 0.5, // check buffer more often
      enableWorker: true,           // offload demuxing to worker
      enableSoftwareAES: true       // in case of encrypted streams
    });

    // 2) wire Hls into Artplayer
    art.hls = hls;
    hls.loadSource(url);
    hls.attachMedia(video);

    // 3) automatic error recovery
    hls.on(Hls.Events.ERROR, (event, data) => {
      console.warn('HLS error', data);
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            // try to recover network error
            console.warn('Network error – retrying');
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            // try to recover media error
            console.warn('Media error – recovering');
            hls.recoverMediaError();
            break;
          default:
            // cannot recover
            console.error('Unrecoverable error – destroying HLS');
            hls.destroy();
            break;
        }
      }
    });

    // 4) cleanup when Artplayer is destroyed
    art.once('destroy', () => {
      hls.destroy();
    });
  }
  else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // native HLS fallback
    video.src = url;
    video.addEventListener('loadedmetadata', () => {
      video.play();
    });
  }
  else {
    art.notice.show = 'Unsupported playback format: m3u8';
  }
}


// var playM3u8 = (video, url, art) => {
//   if (Hls.isSupported()) {
//     const hls = new Hls();

//     art.hls = hls;
//     art.hls.loadSource(url);
//     art.hls.attachMedia(video);

//     art.once("url", () => hls.destroy());
//     art.once("destroy", () => hls.destroy());
//   } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
//     art.switchUrl(url);
//     art.seek = 0;
//   } else {
//     art.notice.show = "Unsupported playback format: m3u8";
//   }
// };
