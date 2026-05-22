interface BrandMarkProps {
  size?: number;
  title?: string;
}

let idCounter = 0;
function uid(): string {
  idCounter += 1;
  return `catm-mark-${idCounter}`;
}

export function BrandMark({ size = 36, title }: BrandMarkProps): React.JSX.Element {
  const gradientId = uid();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5b6cff" />
          <stop offset="100%" stopColor="#8a98ff" />
        </linearGradient>
      </defs>
      <path
        d="M18 4 H46 Q60 4 60 18 V40 Q60 54 46 54 H30 L20 62 L22.5 54 H18 Q4 54 4 40 V18 Q4 4 18 4 Z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M41 22 A12 12 0 1 0 41 36"
        fill="none"
        stroke="#ffffff"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
