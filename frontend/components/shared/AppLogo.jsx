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
        src="/assets/images/rang_reel_white_logo.svg"
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
        src="/assets/images/rang_reel_black_logo.svg"
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
        src="/assets/images/rang_reel_black_logo.svg"
        alt={alt}
        width={width}
        height={height}
        className={`dark:hidden ${className}`.trim()}
      />
      <img
        src="/assets/images/rang_reel_white_logo.svg"
        alt={alt}
        width={width}
        height={height}
        className={`hidden dark:block ${className}`.trim()}
      />
    </>
  );
}
