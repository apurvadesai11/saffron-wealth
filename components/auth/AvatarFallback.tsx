interface Props {
  firstName: string;
  lastName: string;
  size?: number;
  className?: string;
}

const PALETTE = [
  "bg-rose-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-fuchsia-500",
  "bg-teal-500",
  "bg-orange-500",
];

function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}

export default function AvatarFallback({
  firstName,
  lastName,
  size = 40,
  className = "",
}: Props) {
  const initials =
    `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase() || "?";
  const color = colorForName(`${firstName}${lastName}`);
  const fontSize = Math.max(12, Math.floor(size * 0.42));

  return (
    <div
      role="img"
      aria-label={`${firstName} ${lastName}`}
      className={`${color} text-white rounded-full flex items-center justify-center font-semibold ${className}`}
      style={{ width: size, height: size, fontSize }}
    >
      {initials}
    </div>
  );
}
