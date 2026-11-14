type Wave = {
  phase: number;
  center: number;
  amplitude: number;
  width: number;
};

const LINE_COUNT = 18;

function getPoint(t: number, across: number, wave: Wave) {
  const angle = t * Math.PI * 2 + wave.phase;
  const center = wave.center + Math.sin(angle) * wave.amplitude;
  const width = wave.width * (0.35 + 0.65 * (0.5 + 0.5 * Math.cos(angle + 0.55)));
  return {
    x: Math.round((-30 + t * 460) * 10) / 10,
    y: Math.round((center + across * width) * 10) / 10,
  };
}

function pathFromPoints(points: { x: number; y: number }[]) {
  return points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" ");
}

function makeLongitudinalPaths(wave: Wave) {
  return Array.from({ length: LINE_COUNT }, (_, index) => {
    const across = (index / (LINE_COUNT - 1)) * 2 - 1;
    const points = Array.from({ length: 32 }, (_, pointIndex) =>
      getPoint(pointIndex / 31, across, wave),
    );
    return { d: pathFromPoints(points), across };
  });
}

function makeCrossPaths(wave: Wave) {
  return Array.from({ length: 9 }, (_, index) => {
    const t = (index + 1) / 10;
    const points = Array.from({ length: 16 }, (_, pointIndex) =>
      getPoint(t, (pointIndex / 15) * 2 - 1, wave),
    );
    return pathFromPoints(points);
  });
}

function makeRibbonFill(wave: Wave) {
  const top = Array.from({ length: 32 }, (_, index) => getPoint(index / 31, -1, wave));
  const bottom = Array.from({ length: 32 }, (_, index) => getPoint(1 - index / 31, 1, wave));
  return `${pathFromPoints([...top, ...bottom])} Z`;
}

const blueWave: Wave = { phase: 0.55, center: 116, amplitude: 48, width: 30 };
const slateWave: Wave = { phase: 2.8, center: 120, amplitude: 39, width: 23 };
const blueFill = makeRibbonFill(blueWave);
const blueLines = makeLongitudinalPaths(blueWave);
const blueCrosses = makeCrossPaths(blueWave);
const slateFill = makeRibbonFill(slateWave);
const slateLines = makeLongitudinalPaths(slateWave);
const slateCrosses = makeCrossPaths(slateWave);

export function WidgetRibbon({ panel = false }: { panel?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={`widget-ribbon${panel ? " widget-ribbon-panel" : ""}`}
      viewBox="0 0 400 240"
      preserveAspectRatio="none"
    >
      <g className="ribbon-wave ribbon-wave-blue" data-motion="0">
        <path d={blueFill} fill="#718ff3" fillOpacity="0.1" />
        {blueLines.map(({ d, across }, index) => (
          <path
            key={`blue-line-${index}`}
            d={d}
            fill="none"
            stroke="#587be8"
            strokeOpacity={0.34 + (1 - Math.abs(across)) * 0.24}
            strokeWidth="1.05"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {blueCrosses.map((d, index) => (
          <path
            key={`blue-cross-${index}`}
            d={d}
            fill="none"
            stroke="#587be8"
            strokeOpacity="0.4"
            strokeWidth="0.85"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      <g className="ribbon-wave ribbon-wave-slate" data-motion="2">
        <path d={slateFill} fill="#93a3b8" fillOpacity="0.07" />
        {slateLines.map(({ d, across }, index) => (
          <path
            key={`slate-line-${index}`}
            d={d}
            fill="none"
            stroke="#8495ac"
            strokeOpacity={0.29 + (1 - Math.abs(across)) * 0.2}
            strokeWidth="1.05"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {slateCrosses.map((d, index) => (
          <path
            key={`slate-cross-${index}`}
            d={d}
            fill="none"
            stroke="#8495ac"
            strokeOpacity="0.34"
            strokeWidth="0.85"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  );
}
