"use client";

import { useCallback, useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown, Flame, ArrowLeft, Music2, ListMusic, RotateCcw } from "lucide-react";
import Link from "next/link";

type FilterType = "ALL" | "LIKE" | "DISLIKE" | "FIRE";

interface HistoryItem {
  id: string;
  artistName: string;
  artistNote: string | null;
  audioExt: string;
  avatarPath: string | null;
  playedAt: string | null;
  createdAt: string;
  reactions: Record<string, number>;
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [filter, setFilter] = useState<FilterType>("ALL");
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);

  const loadItems = useCallback(() => {
    setLoading(true);
    const params = filter !== "ALL" ? `?filter=${filter}` : "";
    return fetch(`/api/history${params}`)
      .then((r) => r.json())
      .then((data: HistoryItem[]) => {
        setItems(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const restorePlayed = async () => {
    setRestoring(true);
    try {
      await fetch("/api/submissions/restore", { method: "POST" });
      await loadItems();
    } finally {
      setRestoring(false);
    }
  };

  const filterButtons: { type: FilterType; label: string; icon: React.ReactNode; color: string }[] = [
    { type: "ALL", label: "All", icon: null, color: "#fff" },
    { type: "LIKE", label: "Liked", icon: <ThumbsUp size={16} />, color: "#22c55e" },
    { type: "DISLIKE", label: "Disliked", icon: <ThumbsDown size={16} />, color: "#ef4444" },
    { type: "FIRE", label: "Fire", icon: <Flame size={16} />, color: "#f97316" },
  ];

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      color: "#fff",
      fontFamily: "var(--font-sans)",
    }}>
      {/* Header */}
      <div style={{
        padding: "20px 24px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        backdropFilter: "blur(20px)",
        background: "rgba(10,10,15,0.8)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <Link href="/player" style={{
          color: "rgba(255,255,255,0.5)",
          display: "flex",
          alignItems: "center",
          textDecoration: "none",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = "#fff"}
        onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.5)"}
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>
          History
        </h1>
        <span style={{
          fontSize: 13,
          color: "rgba(255,255,255,0.35)",
          marginLeft: 4,
        }}>
          {items.length} tracks
        </span>
        <button
          onClick={() => void restorePlayed()}
          disabled={restoring}
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.14)",
            background: restoring ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.08)",
            color: "#fff",
            padding: "9px 14px",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            cursor: restoring ? "default" : "pointer",
            opacity: restoring ? 0.6 : 1,
          }}
        >
          <RotateCcw size={14} />
          {restoring ? "Restoring" : "Restore Played"}
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{
        display: "flex",
        gap: 8,
        padding: "16px 24px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}>
        {filterButtons.map((fb) => (
          <button
            key={fb.type}
            onClick={() => setFilter(fb.type)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 20,
              border: "1px solid",
              borderColor: filter === fb.type ? fb.color : "rgba(255,255,255,0.1)",
              background: filter === fb.type ? `${fb.color}18` : "transparent",
              color: filter === fb.type ? fb.color : "rgba(255,255,255,0.5)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
              fontFamily: "inherit",
            }}
          >
            {fb.icon}
            {fb.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "16px 24px" }}>
        {loading ? (
          <div style={{
            display: "flex",
            justifyContent: "center",
            padding: "60px 0",
            color: "rgba(255,255,255,0.3)",
            fontSize: 14,
          }}>
            Loading...
          </div>
        ) : items.length === 0 ? (
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "80px 0",
            gap: 12,
            color: "rgba(255,255,255,0.25)",
          }}>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              {filter === "LIKE" ? <ThumbsUp size={36} /> : filter === "DISLIKE" ? <ThumbsDown size={36} /> : filter === "FIRE" ? <Flame size={36} /> : <ListMusic size={36} />}
            </span>
            <span style={{ fontSize: 14 }}>
              {filter === "ALL" ? "No tracks in history yet" : `No ${filter.toLowerCase()} tracks yet`}
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {items.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 16px",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.03)",
                  transition: "background 0.15s",
                  cursor: "default",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
              >
                {/* Avatar */}
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.08)",
                  overflow: "hidden",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                }}>
                  {item.avatarPath ? (
                    <img
                      src={"/api/avatars/" + item.avatarPath.split("/").pop()}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <Music2 size={18} color="rgba(255,255,255,0.55)" />
                  )}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {item.artistName}
                  </div>
                  {item.artistNote && (
                    <div style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.35)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      marginTop: 2,
                    }}>
                      {item.artistNote}
                    </div>
                  )}
                </div>

                {/* Reactions */}
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
                  {(item.reactions.LIKE ?? 0) > 0 && (
                    <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#22c55e", fontSize: 13, fontWeight: 600 }}>
                      <ThumbsUp size={14} /> {item.reactions.LIKE}
                    </span>
                  )}
                  {(item.reactions.FIRE ?? 0) > 0 && (
                    <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#f97316", fontSize: 13, fontWeight: 600 }}>
                      <Flame size={14} /> {item.reactions.FIRE}
                    </span>
                  )}
                  {(item.reactions.DISLIKE ?? 0) > 0 && (
                    <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#ef4444", fontSize: 13, fontWeight: 600 }}>
                      <ThumbsDown size={14} /> {item.reactions.DISLIKE}
                    </span>
                  )}
                  {Object.keys(item.reactions).length === 0 && (
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.15)" }}>—</span>
                  )}
                </div>

                {/* Time */}
                <div style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.25)",
                  flexShrink: 0,
                  minWidth: 55,
                  textAlign: "right",
                }}>
                  {timeAgo(item.playedAt ?? item.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
