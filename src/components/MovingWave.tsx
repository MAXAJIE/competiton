type MovingWaveProps = {
  variant: "cash" | "shared";
};

const paths = {
  cash: {
    viewBox: "0 0 400 280",
    line: "M0 150 C50 70 150 70 200 150 S350 230 400 150 C450 70 550 70 600 150 S750 230 800 150",
    lineOffsets: [-28, -21, -14, -7, 0, 7, 14, 21, 28],
  },
  shared: {
    viewBox: "0 0 1200 600",
    line: "M0 300 C150 140 450 140 600 300 S1050 460 1200 300 C1350 140 1650 140 1800 300 S2250 460 2400 300",
    lineOffsets: [-56, -42, -28, -14, 0, 14, 28, 42, 56],
  },
} as const;

export function MovingWave({ variant }: MovingWaveProps) {
  const { viewBox, line, lineOffsets } = paths[variant];

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={`dashboard-wave dashboard-wave-${variant}`}
      viewBox={viewBox}
      preserveAspectRatio="none"
    >
      <g className="dashboard-wave-track">
        <path className="dashboard-wave-glow" d={line} />
        {lineOffsets.map((offset, index) => (
          <path
            key={offset}
            className={`dashboard-wave-line${index === Math.floor(lineOffsets.length / 2) ? " dashboard-wave-line-center" : ""}`}
            d={line}
            transform={`translate(0 ${offset})`}
          />
        ))}
      </g>
    </svg>
  );
}
