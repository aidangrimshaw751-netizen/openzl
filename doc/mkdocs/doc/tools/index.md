---
hide:
  - navigation
  - toc
---

<div class="openzl-tools-landing">
  <header class="openzl-tools-landing__intro">
    <h1>Tools</h1>
    <p>Explore how OpenZL works with interactive tools that run right in your browser. Nothing leaves your machine.</p>
  </header>

  <div class="openzl-tools-grid">
    <section class="openzl-tool-card" aria-labelledby="trace-visualization-title">
      <div class="openzl-tool-card__art" aria-hidden="true">
        <svg class="openzl-trace-art" viewBox="0 0 400 160">
          <path class="openzl-trace-art__edge" d="M200 36V46M200 68V78M66 78H334M66 78V88M200 78V88M334 78V88M66 118V128M200 118V128M334 118V128" />
          <rect class="openzl-trace-art__stream" x="142" y="6" width="116" height="30" rx="3" />
          <text class="openzl-trace-art__title" x="200" y="19">#0 Serial · 7.25 MB</text>
          <text class="openzl-trace-art__detail" x="200" y="30">input</text>
          <rect class="openzl-trace-art__graph" x="130" y="46" width="140" height="22" rx="4" />
          <text class="openzl-trace-art__graph-label" x="200" y="60">split_by_struct</text>
          <rect class="openzl-trace-art__stream" x="8" y="88" width="116" height="30" rx="3" />
          <text class="openzl-trace-art__title" x="66" y="101">#1 Struct(8) · 4.14 MB</text>
          <text class="openzl-trace-art__detail" x="66" y="112">57%</text>
          <rect class="openzl-trace-art__stream" x="142" y="88" width="116" height="30" rx="3" />
          <text class="openzl-trace-art__title" x="200" y="101">#2 Struct(4) · 2.07 MB</text>
          <text class="openzl-trace-art__detail" x="200" y="112">29%</text>
          <rect class="openzl-trace-art__stream" x="276" y="88" width="116" height="30" rx="3" />
          <text class="openzl-trace-art__title" x="334" y="101">#3 Struct(2) · 1.04 MB</text>
          <text class="openzl-trace-art__detail" x="334" y="112">14%</text>
          <rect class="openzl-trace-art__codec" x="8" y="128" width="116" height="24" rx="4" />
          <text class="openzl-trace-art__codec-label" x="66" y="143">field_lz</text>
          <rect class="openzl-trace-art__codec" x="142" y="128" width="116" height="24" rx="4" />
          <text class="openzl-trace-art__codec-label" x="200" y="143">zstd</text>
          <rect class="openzl-trace-art__codec" x="276" y="128" width="116" height="24" rx="4" />
          <text class="openzl-trace-art__codec-label" x="334" y="143">huffman</text>
        </svg>
      </div>

      <div class="openzl-tool-card__body">
        <div class="openzl-tool-card__copy">
          <h2 id="trace-visualization-title">Trace Visualizer</h2>
          <p>Visualize the compression graph OpenZL built for your data, and trace where the bytes go.</p>
        </div>

        <a class="openzl-tool-card__button" href="/tools/trace/">
          Launch Visualizer
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path d="M3.5 8h9M8.5 4l4 4-4 4" />
          </svg>
        </a>
      </div>
    </section>

    <section class="openzl-tool-card" aria-labelledby="compression-playground-title">
      <div class="openzl-tool-card__art" aria-hidden="true">
        <svg class="openzl-chart-art" viewBox="0 0 400 160">
          <polyline class="openzl-chart-art__openzl" points="140,24 196,34 240,48 286,68 326,96" />
          <polyline class="openzl-chart-art__zstd" points="24,112 122,120 200,130 268,138 324,146" />
          <polyline class="openzl-chart-art__gzip" points="52,122 96,126 128,130 170,136" />
          <g class="openzl-chart-art__openzl">
            <circle cx="140" cy="24" r="3.5" /><circle cx="196" cy="34" r="3.5" /><circle cx="240" cy="48" r="3.5" /><circle cx="286" cy="68" r="3.5" /><circle cx="326" cy="96" r="3.5" />
            <text x="336" y="100">OpenZL</text>
          </g>
          <g class="openzl-chart-art__zstd">
            <circle cx="24" cy="112" r="3.5" /><circle cx="122" cy="120" r="3.5" /><circle cx="200" cy="130" r="3.5" /><circle cx="268" cy="138" r="3.5" /><circle cx="324" cy="146" r="3.5" />
            <text x="334" y="150">zstd</text>
          </g>
          <g class="openzl-chart-art__gzip">
            <circle cx="52" cy="122" r="3.5" /><circle cx="96" cy="126" r="3.5" /><circle cx="128" cy="130" r="3.5" /><circle cx="170" cy="136" r="3.5" />
            <text x="44" y="138" text-anchor="end">gzip</text>
          </g>
        </svg>
      </div>

      <div class="openzl-tool-card__body">
        <div class="openzl-tool-card__copy">
          <h2 id="compression-playground-title">Compression Playground</h2>
          <p>Benchmark OpenZL against zstd and gzip on your files and compare ratio against speed.</p>
        </div>

        <a class="openzl-tool-card__button" href="/tools/playground/">
          Open Playground
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path d="M3.5 8h9M8.5 4l4 4-4 4" />
          </svg>
        </a>
      </div>
    </section>
  </div>
</div>
