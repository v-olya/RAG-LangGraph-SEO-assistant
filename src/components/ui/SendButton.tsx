interface SendButtonProps {
  disabled: boolean;
}

export const SendButton = ({ disabled }: SendButtonProps) => (
  <button
    type="submit"
    disabled={disabled}
    className="bg-emerald-500 text-white px-4 py-2 rounded-lg hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-emerald-300 disabled:cursor-not-allowed transition-colors"
    aria-label="Send message"
    title="Send message"
  >
    <svg
      className="w-5 h-5 rotate-90"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
      />
    </svg>
  </button>
);
