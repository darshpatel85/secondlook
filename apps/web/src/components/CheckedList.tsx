type CheckedListProps = {
  checked: string[] | null;
};

export function CheckedList({ checked }: CheckedListProps) {
  return (
    <section className="checked" aria-label="Checked by the agent">
      <h2>Checked and found nothing</h2>
      {checked && checked.length > 0 ? (
        <ul className="checked-list">
          {checked.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted small">The agent has not reported coverage yet.</p>
      )}
    </section>
  );
}
