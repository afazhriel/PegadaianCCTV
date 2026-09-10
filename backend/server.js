import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import express from "express";
import path from "node:path";

import {
  fileURLToPath
} from "node:url";

import cors from "cors";


/*
|--------------------------------------------------------------------------
| BASIC CONFIG
|--------------------------------------------------------------------------
*/

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


/*
 * Python bridge kamu.
 */
const SECURITY_BACKEND =
  process.env.SECURITY_BACKEND ||
  "http://192.168.1.140:8088";


const FRONTEND_DIR =
  path.join(
    __dirname,
    "../frontend"
  );


/*
|--------------------------------------------------------------------------
| EXPRESS
|--------------------------------------------------------------------------
*/

app.disable(
  "x-powered-by"
);


app.use(
  express.json()
);


app.use(
  cors({

    origin: "*",

    methods: [
      "GET",
      "OPTIONS"
    ],

    allowedHeaders: [
      "Content-Type",
      "Accept"
    ]

  })
);


app.use(
  express.static(
    FRONTEND_DIR
  )
);


/*
|--------------------------------------------------------------------------
| HELPER
|--------------------------------------------------------------------------
*/

function sleep(ms) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );

}


/*
 * Fetch biasa tapi ada timeout.
 */
async function fetchResponse(
  url,
  timeoutMs = 6000,
  options = {}
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

        ...options,

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


/*
 * Fetch endpoint JSON.
 */
async function fetchJson(
  url,
  timeoutMs = 6000
) {

  const response =
    await fetchResponse(
      url,
      timeoutMs
    );


  if (
    !response.ok
  ) {

    const body =
      await response
        .text()
        .catch(
          () => ""
        );


    throw new Error(

      `Security Backend HTTP ${response.status}` +

      (
        body
          ? `: ${body.slice(0, 160)}`
          : ""
      )

    );

  }


  return response.json();

}


/*
|--------------------------------------------------------------------------
| NORMALIZE CAMERA LIST
|--------------------------------------------------------------------------
*/

function normalizeCameraList(
  payload
) {

  if (
    Array.isArray(payload)
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


/*
|--------------------------------------------------------------------------
| PLAYLIST REWRITE
|--------------------------------------------------------------------------
*/

function rewritePlaylist(
  content
) {

  const backendBase =
    SECURITY_BACKEND
      .replace(
        /\/+$/,
        ""
      );


  const backendOrigin =
    new URL(
      backendBase
    ).origin;


  return content

    .split(
      /\r?\n/
    )

    .map(
      line => {

        const trimmed =
          line.trim();


        /*
         * Tag HLS.
         *
         * Bisa saja ada:
         *
         * #EXT-X-KEY URI="http://..."
         */
        if (
          !trimmed ||
          trimmed.startsWith("#")
        ) {

          return line

            .replaceAll(
              `${backendBase}/hls/`,
              "/api/hls/"
            )

            .replaceAll(
              `${backendOrigin}/hls/`,
              "/api/hls/"
            );

        }


        /*
         * URL segment absolut.
         */
        if (
          /^https?:\/\//i
            .test(trimmed)
        ) {

          try {

            const url =
              new URL(
                trimmed
              );


            const marker =
              "/hls/";


            const position =
              url.pathname
                .indexOf(
                  marker
                );


            if (
              position >= 0
            ) {

              return (
                "/api/hls/" +

                url.pathname.slice(
                  position +
                  marker.length
                ) +

                url.search
              );

            }

          }

          catch (_) {
          }


          return line;

        }


        /*
         * Contoh:
         *
         * /hls/camera_1/segment.ts
         */
        if (
          trimmed.startsWith(
            "/hls/"
          )
        ) {

          return (
            "/api/hls/" +
            trimmed.slice(
              "/hls/".length
            )
          );

        }


        /*
         * Sudah melalui proxy.
         */
        if (
          trimmed.startsWith(
            "/api/hls/"
          )
        ) {

          return trimmed;

        }


        /*
         * Kalau:
         *
         * segment0001.ts
         *
         * BIARKAN RELATIF.
         *
         * Browser otomatis resolve ke:
         *
         * /api/hls/camera_1/segment0001.ts
         */
        return line;

      }
    )

    .join(
      "\n"
    );

}


/*
|--------------------------------------------------------------------------
| HEALTH
|--------------------------------------------------------------------------
*/

app.get(
  "/api/health",
  async (
    req,
    res
  ) => {

    try {

      const data =
        await fetchJson(

          `${SECURITY_BACKEND}/api/health`,

          3000

        );


      res.setHeader(
        "Cache-Control",
        "no-store"
      );


      res.status(200)
        .json({

          proxy: "OK",

          security_backend:
            data

        });

    }

    catch (error) {

      res.status(502)
        .json({

          proxy: "OK",

          security_backend:
            "OFFLINE",

          details:
            error.message

        });

    }

  }
);


/*
|--------------------------------------------------------------------------
| SENSOR STATE
|--------------------------------------------------------------------------
*/

app.get(
  "/api/state",
  async (
    req,
    res
  ) => {

    try {

      /*
       * Jangan timeout terlalu lama.
       *
       * Sensor harus ringan.
       */
      const data =
        await fetchJson(

          `${SECURITY_BACKEND}/api/state`,

          4000

        );


      res.setHeader(
        "Cache-Control",
        "no-store"
      );


      return res
        .status(200)
        .json(data);

    }

    catch (error) {

      console.error(
        "[STATE ERROR]",
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


/*
|--------------------------------------------------------------------------
| CAMERA LIST
|--------------------------------------------------------------------------
*/

/*
 * Camera list tidak berubah tiap detik.
 *
 * Cache 5 detik supaya bridge tidak dihajar request.
 */
let cameraCache = {

  data: null,

  expiresAt: 0

};


app.get(
  "/api/cameras",
  async (
    req,
    res
  ) => {

    try {

      const now =
        Date.now();


      /*
       * Gunakan cache.
       */
      if (
        cameraCache.data &&
        now <
        cameraCache.expiresAt
      ) {

        res.setHeader(
          "Cache-Control",
          "no-store"
        );


        return res
          .status(200)
          .json(
            cameraCache.data
          );

      }


      const payload =
        await fetchJson(

          `${SECURITY_BACKEND}/api/cameras`,

          6000

        );


      const cameras =
        normalizeCameraList(
          payload
        );


      cameraCache = {

        data:
          cameras,

        expiresAt:
          now + 5000

      };


      res.setHeader(
        "Cache-Control",
        "no-store"
      );


      console.log(
        `[CAMERAS] ${cameras.length} camera ditemukan`
      );


      return res
        .status(200)
        .json(cameras);

    }

    catch (error) {

      console.error(
        "[CAMERAS ERROR]",
        error.message
      );


      /*
       * Kalau bridge sesaat error tetapi
       * sebelumnya kamera pernah terbaca,
       * jangan kosongkan dashboard.
       */
      if (
        cameraCache.data
      ) {

        return res
          .status(200)
          .json(
            cameraCache.data
          );

      }


      return res
        .status(502)
        .json({

          error:
            "Gagal mengambil daftar kamera",

          details:
            error.message

        });

    }

  }
);


/*
|--------------------------------------------------------------------------
| HLS PROXY
|--------------------------------------------------------------------------
|
| Browser:
|
| /api/hls/camera_1/index.m3u8
|
| Node:
|
| http://192.168.1.140:8088/hls/camera_1/index.m3u8
|
|--------------------------------------------------------------------------
*/

app.get(
  "/api/hls/{*splat}",
  async (
    req,
    res
  ) => {

    /*
     * Express 5 wildcard.
     */
    const rawPath =
      Array.isArray(
        req.params.splat
      )

        ? req.params.splat
          .join("/")

        : String(
          req.params.splat ||
          ""
        );


    const cameraPath =
      rawPath
        .replace(
          /^\/+/,
          ""
        );


    /*
     * Security sederhana.
     */
    if (

      !cameraPath ||

      cameraPath.includes(
        ".."
      ) ||

      !/^[a-zA-Z0-9._/-]+$/
        .test(
          cameraPath
        )

    ) {

      return res
        .status(400)
        .send(
          "Invalid HLS path"
        );

    }


    /*
     * File yang diizinkan.
     */
    const allowed =
      /\.(m3u8|ts|m4s|mp4|aac|key)$/i
        .test(
          cameraPath
        );


    if (!allowed) {

      return res
        .status(400)
        .send(
          "Unsupported HLS file"
        );

    }


    const targetUrl =

      SECURITY_BACKEND
        .replace(
          /\/+$/,
          ""
        ) +

      "/hls/" +

      cameraPath;


    try {

      /*
      |--------------------------------------------------------------------------
      | PLAYLIST M3U8
      |--------------------------------------------------------------------------
      */

      if (
        cameraPath.endsWith(
          ".m3u8"
        )
      ) {

        let lastStatus =
          503;


        let lastBody =
          "";


        /*
         * Hanya 3 kali.
         *
         * KODE LAMA:
         * satu kamera bisa ditahan 15 detik.
         *
         * Kalau 8 kamera melakukan itu,
         * server menderita untuk dosa yang
         * tidak pernah dia lakukan.
         */
        for (
          let attempt = 1;
          attempt <= 3;
          attempt++
        ) {

          const upstream =
            await fetchResponse(

              targetUrl,

              3500

            );


          lastStatus =
            upstream.status;


          lastBody =
            await upstream
              .text();


          const validPlaylist =

            upstream.ok &&

            lastBody
              .trimStart()
              .startsWith(
                "#EXTM3U"
              );


          if (
            validPlaylist
          ) {

            const playlist =
              rewritePlaylist(
                lastBody
              );


            res.setHeader(

              "Content-Type",

              upstream.headers
                .get(
                  "content-type"
                ) ||

              "application/vnd.apple.mpegurl"

            );


            /*
             * Playlist live jangan cache.
             */
            res.setHeader(

              "Cache-Control",

              "no-store, no-cache, must-revalidate"

            );


            res.setHeader(
              "Pragma",
              "no-cache"
            );


            res.setHeader(
              "Expires",
              "0"
            );


            return res
              .status(200)
              .send(
                playlist
              );

          }


          /*
           * FFmpeg baru starting.
           *
           * Tunggu sebentar saja.
           */
          if (
            attempt < 3
          ) {

            await sleep(
              500
            );

          }

        }


        /*
         * HLS.js nanti retry.
         *
         * Jangan tahan koneksi browser.
         */
        res.setHeader(
          "Retry-After",
          "1"
        );


        return res
          .status(503)
          .send(

            `Stream belum siap. ` +

            `Status ${lastStatus}. ` +

            lastBody.slice(
              0,
              120
            )

          );

      }


      /*
      |--------------------------------------------------------------------------
      | VIDEO SEGMENT
      |--------------------------------------------------------------------------
      */

      const upstream =
        await fetchResponse(

          targetUrl,

          7000

        );


      if (
        !upstream.ok
      ) {

        const body =
          await upstream
            .text()
            .catch(
              () => ""
            );


        return res
          .status(
            upstream.status
          )
          .send(

            body ||

            `Upstream HTTP ${upstream.status}`

          );

      }


      /*
       * Content-Type.
       */
      const contentType =

        upstream.headers
          .get(
            "content-type"
          )

        ||

        (
          cameraPath.endsWith(
            ".ts"
          )

            ? "video/mp2t"

            : "application/octet-stream"
        );


      res.setHeader(

        "Content-Type",

        contentType

      );


      /*
       * Segment sudah immutable.
       *
       * Cache pendek cukup.
       */
      res.setHeader(

        "Cache-Control",

        "public, max-age=30, immutable"

      );


      /*
       * Kalau tersedia.
       */
      const contentLength =

        upstream.headers
          .get(
            "content-length"
          );


      if (
        contentLength
      ) {

        res.setHeader(

          "Content-Length",

          contentLength

        );

      }


      if (
        !upstream.body
      ) {

        return res.end();

      }


      /*
       * Streaming langsung.
       *
       * Tidak menampung segment di RAM Node.
       */
      const nodeStream =
        Readable.fromWeb(
          upstream.body
        );


      try {

        await pipeline(

          nodeStream,

          res

        );

      }

      catch (error) {

        /*
         * Normal kalau browser refresh
         * atau tab ditutup.
         */
        if (

          error.code !==
          "ERR_STREAM_PREMATURE_CLOSE"

          &&

          error.name !==
          "AbortError"

        ) {

          throw error;

        }

      }

    }

    catch (error) {

      if (

        error.code ===
        "ERR_STREAM_PREMATURE_CLOSE"

        ||

        error.name ===
        "AbortError"

      ) {

        return;

      }


      console.error(

        `[HLS ERROR] ${cameraPath}:`,

        error.message

      );


      if (
        !res.headersSent
      ) {

        return res
          .status(502)
          .send(
            "Gagal mengambil stream CCTV"
          );

      }

    }

  }
);


/*
|--------------------------------------------------------------------------
| SPA FALLBACK
|--------------------------------------------------------------------------
*/

app.get(
  "/{*splat}",
  (
    req,
    res
  ) => {

    /*
     * Jangan fallback endpoint API
     * menjadi index.html.
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


/*
|--------------------------------------------------------------------------
| GLOBAL ERROR
|--------------------------------------------------------------------------
*/

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      "[UNHANDLED ERROR]",
      error
    );


    if (
      !res.headersSent
    ) {

      return res
        .status(500)
        .json({

          error:
            "Internal server error"

        });

    }

  }
);


/*
|--------------------------------------------------------------------------
| START
|--------------------------------------------------------------------------
*/

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      ""
    );

    console.log(
      "========================================="
    );

    console.log(
      `Dashboard : http://0.0.0.0:${PORT}`
    );

    console.log(
      `Bridge    : ${SECURITY_BACKEND}`
    );

    console.log(
      "Sensor    : refresh 1 detik"
    );

    console.log(
      "Camera    : persistent HLS"
    );

    console.log(
      "========================================="
    );

    console.log(
      ""
    );

  }
);