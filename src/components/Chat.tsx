export default function Chat() {
  return (
    <div className="w-full max-w-md bg-white rounded-lg shadow-lg overflow-hidden">
      <div className="bg-emerald-500 text-white p-4 text-center">
        <h1 className="text-lg font-semibold">Chat</h1>
      </div>
      <div className="h-96 p-4 overflow-y-auto">
        {/* Chat messages will go here */}
        <div className="text-center text-gray-500 mt-8">
          Start a conversation...
        </div>
      </div>
      <div className="p-4 border-t">
        <div className="flex">
          <input
            type="text"
            placeholder="Type a message..."
            className="flex-1 px-3 py-2 border rounded-l-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button className="bg-emerald-500 text-white px-4 py-2 rounded-r-lg hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}