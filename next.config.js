/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // pdfjs-dist tries to require 'canvas' in Node environments; alias it away
    // so webpack does not fail when bundling PDF-worker dependencies.
    config.resolve.alias.canvas = false;
    return config;
  },

  // Serve WASM files with the correct MIME type so onnxruntime-web can load
  // them. Without this header, some browsers refuse to instantiate the module.
  async headers() {
    return [
      {
        source: "/:path*.wasm",
        headers: [{ key: "Content-Type", value: "application/wasm" }],
      },
      // Allow SharedArrayBuffer for ONNX multi-threaded WASM backend.
      // Required on every page that loads the ONNX runtime.
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
