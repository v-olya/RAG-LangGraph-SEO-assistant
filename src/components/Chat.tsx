"use client";

import { useState, useCallback, useRef, useEffect, FormEvent, KeyboardEvent } from "react";
import { sanitizeText } from "../../utils/stringUtils";
import { ReloadButton } from "./ui/ReloadButton";
import { SendButton } from "./ui/SendButton";
import { LoadingIndicator } from "./ui/LoadingIndicator";
import { Badge } from "./ui/Badge";
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
    searchIntent?: string;
  };
}

export default function Chat() {
    const handleReload = () => {
      window.location.reload();
    };
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
      const sanitizedInput = sanitizeText(trimmedInput);

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: sanitizedInput,
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
                searchIntent: data.data.searchIntent ?? undefined,
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
    <div className="w-full max-w-screen-md bg-white rounded-lg shadow-lg overflow-hidden">
      <header className="bg-emerald-500 text-white p-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">SEO Assistant Chat</h1>
          <p className="mt-1 text-sm text-emerald-100">
            Ask about keywords, SERP, rankings, or strategy
          </p>
        </div>
        <ReloadButton onClick={handleReload} disabled={isLoading} />
      </header>

      {/* Messages */}
      <div 
        className="min-h-[500px] p-4 overflow-y-auto space-y-4"
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
              className={message.role === "user" ? "flex justify-end" : ""}
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
                      h1: ({ children }) => <h1 className="text-2xl font-bold mt-4 mb-2 text-gray-900 border-b pb-1">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-xl font-bold mt-3 mb-2 text-gray-800">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-lg font-bold mt-2 mb-1 text-gray-800">{children}</h3>,
                      p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed text-gray-700">{children}</p>,
                      strong: ({ children }) => <strong className="font-bold text-gray-900">{children}</strong>,
                      em: ({ children }) => <em className="italic text-gray-800">{children}</em>,
                      ul: ({ children }) => <ul className="list-disc ml-4 mb-3 space-y-1.5 text-gray-700">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal ml-4 mb-3 space-y-1.5 text-gray-700">{children}</ol>,
                      li: ({ children }) => <li className="pl-1">{children}</li>,
                      code: ({ children }) => (
                        <code className="bg-gray-200 px-1.5 py-0.5 rounded text-sm font-mono text-emerald-700 font-medium">
                          {children}
                        </code>
                      ),
                      pre: ({ children }) => (
                        <pre className="bg-gray-100 border border-gray-200 p-3 rounded-lg text-sm font-mono overflow-x-auto my-3 shadow-sm">
                          {children}
                        </pre>
                      ),
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-4 border-emerald-500 pl-4 py-1 my-3 bg-emerald-50/50 italic text-gray-700">
                          {children}
                        </blockquote>
                      ),
                      a: ({ href, children }) => (
                        <a 
                          href={href} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="text-emerald-600 hover:text-emerald-700 underline decoration-emerald-500/30 hover:decoration-emerald-500 transition-colors"
                        >
                          {children}
                        </a>
                      ),
                      hr: () => <hr className="my-4 border-gray-200" />,
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-4 border border-gray-200 rounded-lg">
                          <table className="min-w-full divide-y divide-gray-200">
                            {children}
                          </table>
                        </div>
                      ),
                      thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
                      th: ({ children }) => <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{children}</th>,
                      td: ({ children }) => <td className="px-4 py-2 text-sm text-gray-700 border-t border-gray-100">{children}</td>,
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                )}
                {message.metadata && (
                  <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500 flex gap-2 flex-wrap">
                    {message.metadata.intent && (
                      <Badge label={message.metadata.intent} type="status" />
                    )}
                    {message.metadata.cluster && (
                      <Badge label={message.metadata.cluster} type="cluster" />
                    )}
                    {message.metadata.searchIntent && (
                      <Badge label={message.metadata.searchIntent} type="intent" />
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        
        {isLoading && <LoadingIndicator />}
        
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
        <ReloadButton onClick={handleReload} disabled={isLoading} />
        <SendButton disabled={isLoading || !input.trim()} />
        </div>
        <p id="chat-hint" className="sr-only">
          Press Enter to send your message
        </p>
      </form>
    </div>
  );
}