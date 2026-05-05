export default function AppLogo({
  width = 150,
  height = 38,
  className = "",
  alt = "Rangreel logo",
  variant = "auto",
}) {
  if (variant === "white") {
    return (
      <img
        src="/assets/images/white_logo.png"
        alt={alt}
        width={width}
        height={height}
        className={className}
      />
    );
  }

  if (variant === "black") {
    return (
      <img
        src="/assets/images/black_logo.png"
        alt={alt}
        width={width}
        height={height}
        className={className}
      />
    );
  }

  return (
    <>
      <img
        src="/assets/images/black_logo.png"
        alt={alt}
        width={width}
        height={height}
        className={`dark:hidden ${className}`.trim()}
      />
      <img
        src="/assets/images/white_logo.png"
        alt={alt}
        width={width}
        height={height}
        className={`hidden dark:block ${className}`.trim()}
      />
    </>
  );
}
