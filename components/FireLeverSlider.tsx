interface Props {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  // True once the user has moved this lever off its starting value.
  modified: boolean;
  disabled?: boolean;
  // Visible whether or not the slider is disabled: a greyed-out control needs
  // to say why it is greyed out.
  hint?: string;
}

// One lever of the FIRE page: a labelled native range input and its value.
// The page holds the value; this component only reports what the user did.
export default function FireLeverSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  modified,
  disabled,
  hint,
}: Props) {
  const marker = modified ? "true" : "false";
  return (
    <div data-modified={marker}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-fg-secondary">
          {label}
        </label>
        <output
          htmlFor={id}
          className={`text-sm font-semibold tabular-nums ${modified ? "text-accent" : "text-fg"}`}
        >
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          // Only a finite number is a value the page can compute with; anything
          // else is dropped rather than passed on as NaN.
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="mt-2 w-full accent-accent-solid disabled:opacity-50"
      />
      {hint && (
        <p data-slider-hint className="text-xs text-fg-muted mt-1">
          {hint}
        </p>
      )}
    </div>
  );
}
