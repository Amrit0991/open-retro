import { Icon } from '../ui/icons';

export function MaxVotesSetting({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="btn" style={{ gap: 8, cursor: 'default' }} title="Votes each person can spend">
      <span className="icon-c">
        <Icon name="sliders" size={16} />
      </span>
      Max votes
      <input
        type="number"
        min={1}
        max={99}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: 46,
          height: 26,
          marginLeft: 2,
          textAlign: 'center',
          border: '1px solid var(--line-2)',
          borderRadius: 8,
          background: 'var(--paper)',
          fontVariantNumeric: 'tabular-nums',
        }}
      />
    </label>
  );
}
