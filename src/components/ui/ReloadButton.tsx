interface ReloadButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export const ReloadButton = ({ onClick, disabled = false }: ReloadButtonProps) => (
  <button
    type="button"
    aria-label="Reload the chat"
    title="Reload the chat"
    onClick={onClick}
    disabled={disabled}
    className={`p-2 rounded ${disabled ? 'bg-gray-200 cursor-not-allowed' : ''}`}
  >
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </button>
);
