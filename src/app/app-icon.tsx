// Drawn with shapes only, so ImageResponse needs no font download.
export function AppIconArt({ size, rounded }: { size: number; rounded: boolean }) {
  const unit = size / 16;
  const bar = (height: number, opacity: number) => (
    <div
      style={{
        width: unit * 2.2,
        height: unit * height,
        background: `rgba(255,255,255,${opacity})`,
        borderRadius: unit * 0.6,
      }}
    />
  );
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        gap: unit * 1.2,
        paddingBottom: unit * 4,
        background: "linear-gradient(160deg, #0e6a8f 0%, #0b4f6c 60%, #083a50 100%)",
        borderRadius: rounded ? unit * 3.5 : 0,
      }}
    >
      {bar(4, 0.7)}
      {bar(7, 0.85)}
      {bar(5.5, 0.7)}
      {bar(9, 1)}
    </div>
  );
}
