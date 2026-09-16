import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import http from "node:http";
import https from "node:https";

const __filename =
  fileURLToPath(
    import.meta.url
  );

const __dirname =
  path.dirname(
    __filename
  );


const app =
  express();


const PORT =
  Number(
    process.env.PORT ||
    3000
  );


/* ============================================================
   MINI PC SERVICES
   ============================================================ */

const SECURITY_BACKEND =
  process.env.SECURITY_BACKEND ||
  "http://192.168.1.140:8088";


const MEDIAMTX_WEBRTC_BASE =
  process.env.MEDIAMTX_WEBRTC_BASE ||
  "http://192.168.1.140:8889";


const PLAYBACK_BACKEND =
  process.env.PLAYBACK_BACKEND ||
  "http://192.168.1.140:8090";


/*
 * Playback maksimum 1 jam.
 *
 * Playback API mini PC juga punya guard 1 jam.
 * Guard di Node ini mencegah request ngawur
 * mencapai mini PC.
 */
const PLAYBACK_MAX_SECONDS =
  3600;


/*
 * Dashboard hanya menerima tanggal
 * hari ini + 6 hari sebelumnya.
 */
const PLAYBACK_RETENTION_DAYS =
  7;


/* ============================================================
   FRONTEND DIRECTORY
   ============================================================ */

const FRONTEND_DIR =
  path.join(
    __dirname,
    "../frontend"
  );


/* ============================================================
   EXPRESS CONFIG
   ============================================================ */

app.disable(
  "x-powered-by"
);


app.use(
  express.json()
);


app.use(
  cors({
    origin:
      "*",

    methods: [
      "GET",
      "OPTIONS"
    ],

    allowedHeaders: [
      "Content-Type",
      "Accept",
      "Range"
    ]
  })
);


/*
 * Dashboard lokal harus selalu mengambil
 * data terbaru.
 */
app.use(
  (
    req,
    res,
    next
  ) => {

    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    next();

  }
);


/*
 * Serve:
 *
 * frontend/index.html
 * frontend/hls.min.js
 * asset lain
 */
app.use(
  express.static(
    FRONTEND_DIR
  )
);


/* ============================================================
   FETCH RESPONSE HELPER
   ============================================================ */

async function fetchResponse(
  url,
  timeoutMs = 10000
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () => {

        controller.abort();

      },
      timeoutMs
    );


  try {

    return await fetch(
      url,
      {
        method:
          "GET",

        signal:
          controller.signal,

        cache:
          "no-store"
      }
    );

  }

  catch (error) {

    if (
      error.name ===
      "AbortError"
    ) {

      throw new Error(
        `Timeout mengakses ${url}`
      );

    }


    throw error;

  }

  finally {

    clearTimeout(
      timer
    );

  }

}


/* ============================================================
   FETCH JSON HELPER
   ============================================================ */

async function fetchJson(
  url,
  timeoutMs = 10000
) {

  const response =
    await fetchResponse(
      url,
      timeoutMs
    );


  const text =
    await response.text();


  if (
    !response.ok
  ) {

    throw new Error(
      `HTTP ${response.status}` +
      (
        text
          ? `: ${text.slice(0, 300)}`
          : ""
      )
    );

  }


  try {

    return JSON.parse(
      text
    );

  }

  catch {

    throw new Error(
      `Response bukan JSON dari ${url}`
    );

  }

}


/* ============================================================
   DATE WIB
   ============================================================ */

function getJakartaDateString() {

  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Jakarta",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit"
      }
    );


  const values =
    {};


  for (
    const part of
    formatter.formatToParts(
      new Date()
    )
  ) {

    values[
      part.type
    ] =
      part.value;

  }


  return (
    `${values.year}-` +
    `${values.month}-` +
    `${values.day}`
  );

}


/* ============================================================
   SHIFT DATE
   ============================================================ */

function shiftDateString(
  dateString,
  deltaDays
) {

  const [
    year,
    month,
    day
  ] =
    String(
      dateString
    )
      .split("-")
      .map(Number);


  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );


  date.setUTCDate(
    date.getUTCDate() +
    deltaDays
  );


  return (
    `${date.getUTCFullYear()}-` +
    `${String(
      date.getUTCMonth() + 1
    ).padStart(
      2,
      "0"
    )}-` +
    `${String(
      date.getUTCDate()
    ).padStart(
      2,
      "0"
    )}`
  );

}


/* ============================================================
   TIME PARSER
   ============================================================ */

function parseTimeToSeconds(
  value
) {

  const match =
    String(
      value || ""
    )
      .trim()
      .match(
        /^(\d{2}):(\d{2})(?::(\d{2}))?$/
      );


  if (!match) {

    return null;

  }


  const hour =
    Number(
      match[1]
    );


  const minute =
    Number(
      match[2]
    );


  const second =
    Number(
      match[3] || 0
    );


  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {

    return null;

  }


  return (
    hour * 3600 +
    minute * 60 +
    second
  );

}


/* ============================================================
   PLAYBACK VALIDATION
   ============================================================ */

function validatePlaybackRequest(
  req,
  res,
  next
) {

  const camera =
    String(
      req.query.camera ||
      ""
    ).trim();


  const date =
    String(
      req.query.date ||
      ""
    ).trim();


  const start =
    String(
      req.query.start ||
      ""
    ).trim();


  const end =
    String(
      req.query.end ||
      ""
    ).trim();


  /* ============================
     REQUIRED PARAMETER
     ============================ */

  if (
    !camera ||
    !date ||
    !start ||
    !end
  ) {

    return res
      .status(400)
      .json({

        success:
          false,

        error:
          "camera, date, start, dan end wajib diisi"

      });

  }


  /* ============================
     DATE FORMAT
     ============================ */

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      date
    )
  ) {

    return res
      .status(400)
      .json({

        success:
          false,

        error:
          "Tanggal tidak valid"

      });

  }


  /* ============================
     RETENTION 7 HARI
     ============================ */

  const today =
    getJakartaDateString();


  const minimumDate =
    shiftDateString(
      today,
      -(
        PLAYBACK_RETENTION_DAYS -
        1
      )
    );


  if (
    date < minimumDate ||
    date > today
  ) {

    return res
      .status(400)
      .json({

        success:
          false,

        error:
          "Tanggal hanya tersedia untuk 7 hari terakhir"

      });

  }


  /* ============================
     TIME FORMAT
     ============================ */

  const startSeconds =
    parseTimeToSeconds(
      start
    );


  const endSeconds =
    parseTimeToSeconds(
      end
    );


  if (
    startSeconds === null ||
    endSeconds === null
  ) {

    return res
      .status(400)
      .json({

        success:
          false,

        error:
          "Jam tidak valid"

      });

  }


  /* ============================
     END > START
     ============================ */

  if (
    endSeconds <=
    startSeconds
  ) {

    return res
      .status(400)
      .json({

        success:
          false,

        error:
          "Jam selesai harus setelah jam mulai"

      });

  }


  /* ============================
     MAX 1 JAM
     ============================ */

  const durationSeconds =
    endSeconds -
    startSeconds;


  if (
    durationSeconds >
    PLAYBACK_MAX_SECONDS
  ) {

    return res
      .status(400)
      .json({

        success:
          false,

        error:
          "Rentang maksimum 1 jam"

      });

  }


  next();

}


/* ============================================================
   QUERY STRING
   ============================================================ */

function getQueryString(
  req
) {

  const url =
    new URL(
      req.originalUrl,
      "http://localhost"
    );


  return url.search;

}


/* ============================================================
   JSON PROXY
   ============================================================ */

async function proxyJson(
  res,
  url,
  timeoutMs = 35000
) {

  const response =
    await fetchResponse(
      url,
      timeoutMs
    );


  const body =
    await response.text();


  res.status(
    response.status
  );


  res.setHeader(
    "Content-Type",
    response.headers.get(
      "content-type"
    ) ||
    "application/json; charset=utf-8"
  );


  res.send(
    body
  );

}


/* ============================================================
   HTTP STREAM PROXY
   ============================================================ */

function proxyStream(
  req,
  res,
  endpoint,
  options = {}
) {

  const {
    retry409 = false,
    maxAttempts = 1,
    retryDelayMs = 700
  } =
    options;


  const query =
    getQueryString(
      req
    );


  const target =
    new URL(
      `${PLAYBACK_BACKEND}${endpoint}${query}`
    );


  const client =
    target.protocol === "https:"
      ? https
      : http;


  console.log(
    `[PLAYBACK PROXY] ${target.pathname}${target.search}`
  );


  let activeRequest =
    null;


  let activeResponse =
    null;


  let clientClosed =
    false;


  /*
   * Kalau browser menutup request,
   * hentikan koneksi ke playback API.
   */
  res.once(
    "close",
    () => {

      clientClosed =
        true;


      if (
        activeResponse &&
        !activeResponse.destroyed
      ) {

        activeResponse.destroy();

      }


      if (
        activeRequest &&
        !activeRequest.destroyed
      ) {

        activeRequest.destroy();

      }

    }
  );


  const startAttempt =
    attempt => {

      if (
        clientClosed ||
        res.writableEnded
      ) {

        return;

      }


      const upstreamRequest =
        client.request(
          target,
          {
            method:
              "GET",

            headers: {

              Accept:
                req.headers.accept ||
                "*/*",

              "User-Agent":
                "Local-Security-Dashboard"

            }
          },
          response => {

            activeResponse =
              response;


            const statusCode =
              response.statusCode ||
              502;


            /*
             * Download bisa kena 409 beberapa saat
             * setelah HLS dihentikan.
             *
             * Tunggu lock FFmpeg benar-benar lepas.
             */
            if (
              retry409 &&
              statusCode === 409 &&
              attempt < maxAttempts
            ) {

              console.log(
                `[PLAYBACK PROXY] 409 retry ${attempt}/${maxAttempts}`
              );


              response.resume();


              response.once(
                "end",
                () => {

                  if (
                    clientClosed ||
                    res.writableEnded
                  ) {

                    return;

                  }


                  setTimeout(
                    () => {

                      startAttempt(
                        attempt + 1
                      );

                    },
                    retryDelayMs
                  );

                }
              );


              return;

            }


            res.status(
              statusCode
            );


            /*
             * Header yang memang perlu
             * diteruskan ke browser.
             */
            const headers = [

              "content-type",

              "content-disposition",

              "content-length",

              "cache-control",

              "accept-ranges",

              "x-accel-buffering"

            ];


            for (
              const headerName of headers
            ) {

              const value =
                response.headers[
                headerName
                ];


              if (
                value !== undefined
              ) {

                res.setHeader(
                  headerName,
                  value
                );

              }

            }


            /*
             * Stream langsung:
             *
             * mini PC
             * -> Node
             * -> browser
             */
            response.pipe(
              res
            );


            response.on(
              "error",
              error => {

                console.error(
                  "[PLAYBACK UPSTREAM ERROR]",
                  error.message
                );


                if (
                  !res.writableEnded
                ) {

                  res.end();

                }

              }
            );

          }
        );


      activeRequest =
        upstreamRequest;


      upstreamRequest.on(
        "error",
        error => {

          if (
            clientClosed
          ) {

            return;

          }


          console.error(
            "[PLAYBACK PROXY ERROR]",
            error.message
          );


          if (
            !res.headersSent
          ) {

            return res
              .status(502)
              .json({

                success:
                  false,

                error:
                  "Playback API mini PC tidak dapat diakses",

                details:
                  error.message

              });

          }


          if (
            !res.writableEnded
          ) {

            res.end();

          }

        }
      );


      upstreamRequest.end();

    };


  startAttempt(
    1
  );

}


/* ============================================================
   CAMERA NORMALIZER
   ============================================================ */

function normalizeCameraList(
  payload
) {

  if (
    Array.isArray(
      payload
    )
  ) {

    return payload;

  }


  if (
    Array.isArray(
      payload?.cameras
    )
  ) {

    return payload.cameras;

  }


  return [];

}


/* ============================================================
   ROOT API
   ============================================================ */

app.get(
  "/api",
  (
    req,
    res
  ) => {

    res.json({

      status:
        "OK",

      service:
        "Local Security Dashboard",

      services: {

        security:
          SECURITY_BACKEND,

        media_mtx:
          MEDIAMTX_WEBRTC_BASE,

        playback:
          PLAYBACK_BACKEND

      },

      endpoints: [

        "/api/health",

        "/api/state",

        "/api/nvr",

        "/api/cameras",

        "/api/playback/health",

        "/api/playback/search",

        "/api/playback/stream",

        "/api/playback/download",

        "/api/playback/hls/start",

        "/api/playback/hls/stop",

        "/api/playback/hls/files/:session/index.m3u8"

      ]

    });

  }
);


/* ============================================================
   HEALTH
   ============================================================ */

app.get(
  "/api/health",
  async (
    req,
    res
  ) => {

    const results =
      await Promise.allSettled(
        [

          fetchJson(
            `${SECURITY_BACKEND}/api/health`,
            6000
          ),

          fetchJson(
            `${PLAYBACK_BACKEND}/api/health`,
            6000
          )

        ]
      );


    const bridgeResult =
      results[0];


    const playbackResult =
      results[1];


    const bridgeOnline =
      bridgeResult.status ===
      "fulfilled";


    const playbackOnline =
      playbackResult.status ===
      "fulfilled";


    return res.json({

      proxy:
        "ONLINE",

      bridge:
        bridgeOnline
          ? "ONLINE"
          : "OFFLINE",

      playback:
        playbackOnline
          ? "ONLINE"
          : "OFFLINE",

      bridge_url:
        SECURITY_BACKEND,

      media_mtx:
        MEDIAMTX_WEBRTC_BASE,

      playback_url:
        PLAYBACK_BACKEND,

      bridge_data:
        bridgeOnline
          ? bridgeResult.value
          : null,

      playback_data:
        playbackOnline
          ? playbackResult.value
          : null,

      bridge_error:
        bridgeOnline
          ? null
          : bridgeResult.reason?.message,

      playback_error:
        playbackOnline
          ? null
          : playbackResult.reason?.message

    });

  }
);


/* ============================================================
   SENSOR STATE
   ============================================================ */

app.get(
  "/api/state",
  async (
    req,
    res
  ) => {

    try {

      const data =
        await fetchJson(
          `${SECURITY_BACKEND}/api/state`,
          8000
        );


      return res.json(
        data
      );

    }

    catch (error) {

      console.error(
        "[STATE]",
        error.message
      );


      return res
        .status(502)
        .json({

          error:
            "Gagal mengambil state",

          details:
            error.message

        });

    }

  }
);


/* ============================================================
   NVR STATE
   ============================================================ */

app.get(
  "/api/nvr",
  async (
    req,
    res
  ) => {

    try {

      const state =
        await fetchJson(
          `${SECURITY_BACKEND}/api/state`,
          8000
        );


      return res.json({

        state_nvr:
          state?.state_nvr ??
          "UNKNOWN",

        camera_count:
          state?.nvr_camera_count ??
          0,

        rtsp_port:
          state?.nvr_rtsp_port ??
          554,

        timestamp:
          state?.timestamp ??
          null

      });

    }

    catch (error) {

      console.error(
        "[NVR]",
        error.message
      );


      return res
        .status(502)
        .json({

          state_nvr:
            "OFFLINE",

          camera_count:
            0,

          error:
            error.message

        });

    }

  }
);


/* ============================================================
   CAMERA CACHE
   ============================================================ */

let cameraCache =
{

  data:
    null,

  expiresAt:
    0

};


/* ============================================================
   CAMERA LIST
   ============================================================ */

app.get(
  "/api/cameras",
  async (
    req,
    res
  ) => {

    const now =
      Date.now();


    try {

      /*
       * Cache kamera 5 detik.
       */
      if (
        cameraCache.data &&
        now <
        cameraCache.expiresAt
      ) {

        return res.json(
          cameraCache.data
        );

      }


      const payload =
        await fetchJson(
          `${SECURITY_BACKEND}/api/cameras`,
          8000
        );


      const cameras =
        normalizeCameraList(
          payload
        );


      cameraCache =
      {

        data:
          cameras,

        expiresAt:
          now + 5000

      };


      console.log(
        `[CAMERA] ${cameras.length} kamera`
      );


      return res.json(
        cameras
      );

    }

    catch (error) {

      console.error(
        "[CAMERA]",
        error.message
      );


      /*
       * Kalau bridge sesaat gagal,
       * gunakan cache terakhir.
       */
      if (
        cameraCache.data
      ) {

        return res.json(
          cameraCache.data
        );

      }


      return res
        .status(502)
        .json({

          error:
            "Gagal mengambil kamera",

          details:
            error.message

        });

    }

  }
);


/* ============================================================
   PLAYBACK HEALTH
   ============================================================ */

app.get(
  "/api/playback/health",
  async (
    req,
    res
  ) => {

    try {

      return await proxyJson(
        res,
        `${PLAYBACK_BACKEND}/api/health`,
        10000
      );

    }

    catch (error) {

      console.error(
        "[PLAYBACK HEALTH]",
        error.message
      );


      return res
        .status(502)
        .json({

          success:
            false,

          error:
            "Playback API mini PC offline",

          details:
            error.message

        });

    }

  }
);


/* ============================================================
   PLAYBACK SEARCH
   ============================================================ */

/*
 * Search sengaja TIDAK dibatasi 1 jam.
 *
 * Playback API bisa memakai search satu hari
 * untuk menemukan recording.
 *
 * Yang dibatasi 1 jam adalah:
 * stream, download dan HLS start.
 */
app.get(
  "/api/playback/search",
  async (
    req,
    res
  ) => {

    try {

      const query =
        getQueryString(
          req
        );


      return await proxyJson(
        res,
        `${PLAYBACK_BACKEND}/api/playback/search${query}`,
        35000
      );

    }

    catch (error) {

      console.error(
        "[PLAYBACK SEARCH]",
        error.message
      );


      return res
        .status(502)
        .json({

          success:
            false,

          error:
            "Gagal mengakses playback API mini PC",

          details:
            error.message

        });

    }

  }
);


/* ============================================================
   PLAYBACK STREAM
   ============================================================ */

app.get(
  "/api/playback/stream",

  validatePlaybackRequest,

  (
    req,
    res
  ) => {

    proxyStream(
      req,
      res,
      "/api/playback/stream"
    );

  }
);


/* ============================================================
   PLAYBACK DOWNLOAD
   ============================================================ */

app.get(
  "/api/playback/download",

  validatePlaybackRequest,

  (
    req,
    res
  ) => {

    proxyStream(
      req,
      res,
      "/api/playback/download",
      {

        retry409:
          true,

        maxAttempts:
          10,

        retryDelayMs:
          800

      }
    );

  }
);


/* ============================================================
   PLAYBACK HLS START
   ============================================================ */

app.get(
  "/api/playback/hls/start",

  validatePlaybackRequest,

  (
    req,
    res
  ) => {

    proxyStream(
      req,
      res,
      "/api/playback/hls/start"
    );

  }
);


/* ============================================================
   PLAYBACK HLS STOP
   ============================================================ */

app.get(
  "/api/playback/hls/stop",
  (
    req,
    res
  ) => {

    proxyStream(
      req,
      res,
      "/api/playback/hls/stop"
    );

  }
);


/* ============================================================
   PLAYBACK HLS FILES
   ============================================================ */

app.get(
  "/api/playback/hls/files/{*splat}",
  (
    req,
    res
  ) => {

    proxyStream(
      req,
      res,
      req.path
    );

  }
);


/* ============================================================
   SPA FALLBACK
   ============================================================ */

app.get(
  "/{*splat}",
  (
    req,
    res
  ) => {

    /*
     * Request /api yang salah
     * jangan dilempar ke index.html.
     */
    if (
      req.path.startsWith(
        "/api/"
      )
    ) {

      return res
        .status(404)
        .json({

          error:
            "Endpoint API tidak ditemukan"

        });

    }


    return res.sendFile(
      path.join(
        FRONTEND_DIR,
        "index.html"
      )
    );

  }
);


/* ============================================================
   ERROR HANDLER
   ============================================================ */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      "[UNHANDLED]",
      error
    );


    if (
      !res.headersSent
    ) {

      return res
        .status(500)
        .json({

          error:
            "Internal server error",

          details:
            error.message

        });

    }

  }
);


/* ============================================================
   START
   ============================================================ */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log("");

    console.log(
      "========================================="
    );

    console.log(
      " LOCAL SECURITY DASHBOARD"
    );

    console.log(
      "========================================="
    );

    console.log(
      `Dashboard : http://localhost:${PORT}`
    );

    console.log(
      `Bridge    : ${SECURITY_BACKEND}`
    );

    console.log(
      `MediaMTX  : ${MEDIAMTX_WEBRTC_BASE}`
    );

    console.log(
      `Playback  : ${PLAYBACK_BACKEND}`
    );

    console.log(
      "-----------------------------------------"
    );

    console.log(
      "Sensor    : PROXY ENABLED"
    );

    console.log(
      "Camera    : PROXY ENABLED"
    );

    console.log(
      "Live CCTV : PLAY ON DEMAND"
    );

    console.log(
      "Playback  : MAX 1 JAM"
    );

    console.log(
      "Retention : 7 HARI"
    );

    console.log(
      "Download  : MINI PC PROXY ENABLED"
    );

    console.log(
      "========================================="
    );

    console.log("");

  }
);
