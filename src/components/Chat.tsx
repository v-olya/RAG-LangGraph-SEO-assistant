"use client";

import { useState, useCallback, useRef, useEffect, FormEvent, KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatResponse } from "@/app/api/chat/route";

declare const crypto: {
  randomUUID(): string;
};

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: {
    intent?: string;
    cluster?: string;
  };
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      
      const trimmedInput = input.trim();
      if (!trimmedInput || isLoading) return;

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmedInput,
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setIsLoading(true);

      // Build conversation history for context
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            query: trimmedInput,
            history,
          }),
        });

        const data: ChatResponse = await response.json();

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.success && data.data 
            ? data.data.answer 
            : data.error || "An error occurred",
          metadata: data.success && data.data
            ? {
                intent: data.data.intent ?? undefined,
                cluster: data.data.cluster,
              }
            : undefined,
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (error) {
        console.error("Chat error:", error);
        
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Failed to connect to the server. Please try again.",
        };
        
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [input, isLoading]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit]
  );

  return (
    <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <header className="bg-emerald-500 text-white p-4 text-center">
        <h1 className="text-lg font-semibold">SEO Analysis Chat</h1>
        <p className="text-sm text-emerald-100">
          Ask about keywords, SERP,  rankings, or strategy
        </p>
      </header>

      {/* Messages */}
      <div 
        className="h-[500px] p-4 overflow-y-auto space-y-4"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 mt-8">
            <p className="mb-2">Start a conversation...</p>
            <p className="text-xs text-gray-400">
              Try: &quot;What type of content is performing best for ...?&quot;<br /><br />
              &quot;How has SERP changed for ... since ...?&quot;
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`rounded-lg px-4 py-2 break-words ${
                  message.role === "user"
                    ? "mt-2 border border-emerald-500"
                    : "mt-1 bg-gray-100 text-gray-800"
                }`}
              >
                {message.role === "user" ? (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                ) : (
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                      li: ({ children }) => <li>{children}</li>,
                      code: ({ children }) => <code className="bg-gray-200 px-1 py-0.5 rounded text-sm font-mono">{children}</code>,
                      pre: ({ children }) => <pre className="bg-gray-200 p-2 rounded text-sm font-mono overflow-x-auto mb-2">{children}</pre>,
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                )}
                {message.metadata && (
                  <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500 flex gap-2 flex-wrap">
                    {message.metadata.intent && (
                      <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded capitalize">
                        {message.metadata.intent.toLowerCase()}
                      </span>
                    )}
                    {message.metadata.cluster && (
                      <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                        cluster: {message.metadata.cluster}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-4 py-2">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t">
        <div className="flex gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Type your message
          </label>
          <input
            id="chat-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about SEO..."
            disabled={isLoading}
            className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50 disabled:cursor-not-allowed"
            aria-describedby="chat-hint"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-emerald-500 text-white px-4 py-2 rounded-lg hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-emerald-300 disabled:cursor-not-allowed transition-colors"
            aria-label="Send message"
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
        </div>
        <p id="chat-hint" className="sr-only">
          Press Enter to send your message
        </p>
      </form>
    </div>
  );
}