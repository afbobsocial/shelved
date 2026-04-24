import React, { useState, useEffect, useRef, memo } from "react";
import { Search, BookOpen, MessageCircle, Plus, X, Send, Loader2, Bookmark, Check, Trash2, Link2, Upload, Sparkles, Layers, AlignLeft, Wand2 } from "lucide-react";
import Papa from "papaparse";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_KEY
);

// ── Constants ──────────────────────────────────────────────────────────────

const STATUSES = {
  read:    { label: "Read",    icon: Check },
  reading: { label: "Reading", icon: BookOpen },
  want:    { label: "Want",    icon: Bookmark },
};

const GENRES = [
  "Literary Fiction","Classics","Mystery","Horror","Sci-Fi","Fantasy",
  "Historical Fiction","Children's/YA","Short Stories","Drama","Humor",
  "Graphic Novel","Memoir/Essay","History","Philosophy","Science",
  "Romance","Poetry","Other",
];

const SPINE_PALETTE = [
  "#E63946","#F77F00","#FCBF49","#06A77D","#118AB2",
  "#073B4C","#8338EC","#3A86FF","#FB5607","#FF006E",
  "#2B9348","#D62828","#003049","#F4A261","#264653",
  "#E76F51","#457B9D","#1D3557","#BC4749","#386641",
];

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const FONT_SERIF   = "'Fraunces', Georgia, serif";
const FONT_SANS    = "'Inter Tight', 'Helvetica Neue', system-ui, sans-serif";
const FONT_MONO    = "'JetBrains Mono', ui-monospace, monospace";
const BG           = "#F5F1EA";
const INK          = "#0E0E0E";
const MUTED        = "#6B6660";
const RULE         = "#A8A095";
const RULE_SOFT    = "#C8C0B2";

// ── Helpers ────────────────────────────────────────────────────────────────

function hashString(str) {
  let h = 0;
  for (let i = 0; i < (str || "").length; i++) h = (h << 5) - h + str.charCodeAt(i);
  return Math.abs(h);
}

function spineColorFor(book) {
  return SPINE_PALETTE[hashString(book.id || book.title) % SPINE_PALETTE.length];
}

function spineWidthFor(book) {
  const w = hashString((book.id || book.title) + "w") % 100;
  return 72 + (w / 100) * 28;
}

function fgColorFor(book) {
  const options = ["#FBF7EE", "#FFFFFF", "#F0EBE0", "#FFF8F0"];
  return options[hashString((book.id || book.title) + "fg") % 4];
}

function genreForBook(book) {
  return book.genre || null;
}

// Fetch all users once (for id->name mapping display)
async function loadAllUsers() {
  try {
    var { data, error } = await supabase.from("users").select("id, name");
    if (error) throw error;
    return data || [];
  } catch(e) { console.error("loadAllUsers:", e); return []; }
}

// ── Genre classifier ──
// Maps Open Library subjects and Google Books categories to our GENRES list.
// Returns the best match or null. Order matters — more specific genres first.
function classifyGenre(subjects) {
  if (!subjects || subjects.length === 0) return null;
  var joined = subjects.join(" ").toLowerCase();

  // Order matters: check specific before general (e.g. "science fiction" before "fiction")
  var rules = [
    { match: ["horror", "gothic", "supernatural", "ghost stor"], genre: "Horror" },
    { match: ["science fiction", "sci-fi", "scifi", "dystopia", "cyberpunk", "space opera"], genre: "Sci-Fi" },
    { match: ["fantasy", "dragons", "magic", "mythology", "epic fantasy"], genre: "Fantasy" },
    { match: ["mystery", "detective", "crime", "thriller", "suspense", "noir", "whodunit"], genre: "Mystery" },
    { match: ["romance", "love stor"], genre: "Romance" },
    { match: ["children", "juvenile", "young adult", "picture book", " ya "], genre: "Children's/YA" },
    { match: ["historical fiction", "historical novel"], genre: "Historical Fiction" },
    { match: ["classic", "literary classic"], genre: "Classics" },
    { match: ["poetry", "poems", "verse"], genre: "Poetry" },
    { match: ["drama", "plays", "theater", "theatre"], genre: "Drama" },
    { match: ["humor", "comedy", "satire"], genre: "Humor" },
    { match: ["graphic novel", "comics", "manga"], genre: "Graphic Novel" },
    { match: ["short stor"], genre: "Short Stories" },
    { match: ["memoir", "autobiography", "essay", "biography"], genre: "Memoir/Essay" },
    { match: ["history", "historical"], genre: "History" },
    { match: ["philosophy", "philosoph"], genre: "Philosophy" },
    { match: ["science", "physics", "biology", "astronom", "chemistry", "mathematics"], genre: "Science" },
    { match: ["literary fiction", "literature", "fiction"], genre: "Literary Fiction" },
  ];

  for (var i = 0; i < rules.length; i++) {
    for (var j = 0; j < rules[i].match.length; j++) {
      if (joined.indexOf(rules[i].match[j]) !== -1) return rules[i].genre;
    }
  }
  return null;
}

// ── Search ─────────────────────────────────────────────────────────────────

async function searchBooksDirect(query) {
  const q = encodeURIComponent(query);
  const [olRes, gbRes] = await Promise.allSettled([
    fetch("https://openlibrary.org/search.json?q=" + q + "&limit=10&fields=key,title,author_name,first_publish_year,cover_i,isbn,subject")
      .then(function(r) { return r.ok ? r.json() : null; }),
    fetch("https://www.googleapis.com/books/v1/volumes?q=" + q + "&maxResults=10&fields=items(id,volumeInfo(title,authors,publishedDate,imageLinks,industryIdentifiers,categories))")
      .then(function(r) { return r.ok ? r.json() : null; }),
  ]);

  var results = [];
  var seen = new Set();

  function key(t, a) {
    return ((t || "").toLowerCase().trim()) + "|" + ((a || "").toLowerCase().trim());
  }

  if (olRes.status === "fulfilled" && olRes.value && olRes.value.docs) {
    for (var di = 0; di < olRes.value.docs.length; di++) {
      var doc = olRes.value.docs[di];
      var title = doc.title;
      var author = (doc.author_name && doc.author_name[0]) || "Unknown";
      if (!title) continue;
      var k = key(title, author);
      if (seen.has(k)) continue;
      seen.add(k);
      var isbn = null;
      if (doc.isbn) {
        for (var ii = 0; ii < doc.isbn.length; ii++) {
          if (doc.isbn[ii].length === 13) { isbn = doc.isbn[ii]; break; }
        }
        if (!isbn) isbn = doc.isbn[0] || null;
      }
      results.push({
        id: isbn ? ("isbn:" + isbn) : (doc.key || ("ol_" + hashString(title + author))),
        title: title, author: author,
        year: doc.first_publish_year || null,
        coverId: doc.cover_i || null,
        isbn: isbn, googleThumb: null,
        genre: classifyGenre(doc.subject),
      });
    }
  }

  if (gbRes.status === "fulfilled" && gbRes.value && gbRes.value.items) {
    for (var gi = 0; gi < gbRes.value.items.length; gi++) {
      var item = gbRes.value.items[gi];
      var info = item.volumeInfo || {};
      var gtitle = info.title;
      var gauthor = (info.authors && info.authors[0]) || "Unknown";
      if (!gtitle) continue;
      var gk = key(gtitle, gauthor);
      if (seen.has(gk)) continue;
      seen.add(gk);
      var thumb = (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) || null;
      if (thumb) thumb = thumb.replace(/^http:/, "https:").replace(/zoom=\d/, "zoom=1");
      var gisbn = null;
      if (info.industryIdentifiers) {
        for (var xi = 0; xi < info.industryIdentifiers.length; xi++) {
          if (info.industryIdentifiers[xi].type === "ISBN_13") {
            gisbn = info.industryIdentifiers[xi].identifier; break;
          }
        }
        if (!gisbn && info.industryIdentifiers[0]) gisbn = info.industryIdentifiers[0].identifier;
      }
      var gyear = info.publishedDate ? parseInt(info.publishedDate, 10) : null;
      results.push({
        id: gisbn ? ("isbn:" + gisbn) : ("gb_" + item.id),
        title: gtitle, author: gauthor,
        year: isFinite(gyear) ? gyear : null,
        coverId: null, isbn: gisbn, googleThumb: thumb,
        genre: classifyGenre(info.categories),
      });
    }
  }

  return results.slice(0, 12);
}

async function searchBooksViaClaude(query) {
  var response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: "Find books matching: " + query + ". Return ONLY a JSON array, no markdown, no explanation. Each object needs: title, author, year (number or null), isbn (13-digit string or null). Example: [{\"title\":\"Dune\",\"author\":\"Frank Herbert\",\"year\":1965,\"isbn\":\"9780441013593\"}]" }],
    }),
  });
  var data = await response.json();
  var text = data.content.map(function(i) { return i.type === "text" ? i.text : ""; }).join("\n");
  var match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    var books = JSON.parse(match[0]);
    return books.map(function(b, i) {
      return {
        id: b.isbn ? ("isbn:" + b.isbn) : ("ai_" + hashString((b.title || "") + (b.author || "")) + "_" + i),
        title: b.title || "Unknown", author: b.author || "Unknown",
        year: b.year || null, coverId: null, isbn: b.isbn || null, googleThumb: null,
      };
    });
  } catch(e) { return []; }
}

async function searchBooks(query) {
  try {
    var direct = await searchBooksDirect(query);
    if (direct.length > 0) return direct;
  } catch(e) { /* fall through */ }
  return searchBooksViaClaude(query);
}

// ── Cover URLs ─────────────────────────────────────────────────────────────

function getCoverUrls(book) {
  var urls = [];
  if (book.coverId) {
    urls.push("https://covers.openlibrary.org/b/id/" + book.coverId + "-L.jpg");
    urls.push("https://covers.openlibrary.org/b/id/" + book.coverId + "-M.jpg");
  }
  if (book.isbn) {
    urls.push("https://covers.openlibrary.org/b/isbn/" + book.isbn + "-L.jpg");
    urls.push("https://covers.openlibrary.org/b/isbn/" + book.isbn + "-M.jpg");
  }
  if (book.googleThumb) urls.push(book.googleThumb);
  return urls;
}

// ── Procedural Cover Motifs ────────────────────────────────────────────────

var MOTIFS = [
  function(c) {
    return (
      <g fill={c}>
        <path d="M100 70 L108 108 L145 100 L112 118 L140 155 L105 128 L95 168 L93 125 L55 150 L85 115 L50 95 L92 105 Z" />
        <circle cx="55" cy="135" r="2.5" /><circle cx="150" cy="80" r="1.8" />
      </g>
    );
  },
  function(c) {
    return (
      <g fill="none" stroke={c} strokeWidth="2">
        <ellipse cx="100" cy="110" rx="60" ry="18" />
        <ellipse cx="100" cy="110" rx="60" ry="18" transform="rotate(45 100 110)" />
        <ellipse cx="100" cy="110" rx="60" ry="18" transform="rotate(-45 100 110)" />
        <circle cx="100" cy="110" r="6" fill={c} />
      </g>
    );
  },
  function(c) {
    return (
      <g fill={c}>
        <polygon points="100,55 150,150 50,150" opacity="0.35" />
        <polygon points="100,80 140,155 60,155" opacity="0.6" />
        <polygon points="100,105 130,160 70,160" />
      </g>
    );
  },
  function(c) {
    var dots = [];
    for (var r = 0; r < 6; r++) {
      for (var col = 0; col < 6; col++) {
        dots.push(<circle key={r + "-" + col} cx={62 + col*16} cy={66 + r*16} r={2 + (r+col)%3} />);
      }
    }
    return <g fill={c}>{dots}</g>;
  },
  function(c) {
    return (
      <g>
        <circle cx="100" cy="110" r="52" fill={c} />
        <circle cx="115" cy="95" r="38" fill="var(--cover-bg)" />
      </g>
    );
  },
  function(c) {
    return (
      <g fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round">
        <path d="M40 80 Q 60 60 80 80 T 120 80 T 160 80" />
        <path d="M40 105 Q 60 85 80 105 T 120 105 T 160 105" opacity="0.7" />
        <path d="M40 130 Q 60 110 80 130 T 120 130 T 160 130" opacity="0.45" />
        <path d="M40 155 Q 60 135 80 155 T 120 155 T 160 155" opacity="0.25" />
      </g>
    );
  },
  function(c) {
    var lines = [];
    for (var i = 0; i < 14; i++) {
      var a = (i / 14) * Math.PI * 2;
      lines.push(<line key={i} x1={100 + Math.cos(a)*16} y1={110 + Math.sin(a)*16} x2={100 + Math.cos(a)*55} y2={110 + Math.sin(a)*55} />);
    }
    return (
      <g stroke={c} strokeWidth="2" strokeLinecap="round">
        {lines}
        <circle cx="100" cy="110" r="8" fill={c} />
      </g>
    );
  },
  function(c) {
    return (
      <g fill={c}>
        <rect x="55" y="65" width="50" height="50" opacity="0.3" />
        <rect x="80" y="90" width="50" height="50" opacity="0.55" />
        <rect x="105" y="115" width="50" height="50" />
      </g>
    );
  },
  function(c) {
    return (
      <g fill={c}>
        <rect x="85" y="55" width="30" height="120" rx="2" />
        <rect x="40" y="100" width="120" height="30" rx="2" />
        <circle cx="100" cy="115" r="8" fill="var(--cover-bg)" />
      </g>
    );
  },
  function(c) {
    return (
      <g fill={c}>
        <circle cx="65" cy="75" r="6" />
        <rect x="85" y="60" width="14" height="14" transform="rotate(30 92 67)" />
        <polygon points="120,70 130,85 110,85" />
        <circle cx="145" cy="90" r="10" />
        <circle cx="60" cy="115" r="12" opacity="0.5" />
        <rect x="95" y="110" width="20" height="20" transform="rotate(15 105 120)" opacity="0.7" />
        <polygon points="145,125 155,140 135,140" opacity="0.85" />
        <circle cx="75" cy="155" r="8" opacity="0.6" />
      </g>
    );
  },
  function(c) {
    var rects = [];
    for (var i = 0; i < 7; i++) {
      rects.push(<rect key={i} x="35" y={60 + i*26} width={80 + i*6} height={i%2===0 ? 14 : 8} opacity={1 - i*0.1} rx="1" />);
    }
    return <g fill={c}>{rects}</g>;
  },
  function(c) {
    var polys = [];
    for (var row = -1; row < 3; row++) {
      for (var col = -1; col < 4; col++) {
        var pts = (70+col*30)+","+(80+row*30)+" "+(85+col*30)+","+(65+row*30)+" "+(100+col*30)+","+(80+row*30)+" "+(85+col*30)+","+(95+row*30);
        polys.push(<polygon key={row+"-"+col} points={pts} opacity="0.65" />);
      }
    }
    return <g fill="none" stroke={c} strokeWidth="1.5">{polys}</g>;
  },
  function(c) {
    var radii = [48, 38, 28, 18, 8];
    return (
      <g fill="none" stroke={c}>
        {radii.map(function(r, i) {
          return <circle key={i} cx="100" cy="115" r={r} strokeWidth={i===0 ? 1 : 1.5} opacity={0.3 + i*0.15} />;
        })}
      </g>
    );
  },
  function(c) {
    var lns = [];
    for (var i = 0; i < 9; i++) {
      lns.push(<line key={i} x1={32+i*16} y1="60" x2={32+i*16+65} y2="185" opacity={0.35+i*0.07} />);
    }
    return <g stroke={c} strokeWidth="2.5" strokeLinecap="round">{lns}</g>;
  },
  function(c) {
    return (
      <g fill="none" stroke={c} strokeWidth="2">
        <path d="M100 115 Q120 95 115 78 Q105 62 88 68 Q68 76 70 100 Q72 126 100 133 Q130 137 142 112 Q152 84 132 63 Q110 42 83 48 Q52 57 48 91 Q43 127 68 150" strokeLinecap="round" />
      </g>
    );
  },
  function(c) {
    var coords = [[45,65],[80,65],[115,65],[150,65],[45,100],[80,100],[115,100],[150,100],[45,135],[80,135],[115,135],[150,135]];
    return (
      <g fill={c}>
        {coords.map(function(xy, i) {
          return <rect key={i} x={xy[0]} y={xy[1]} width="28" height="28" rx="3" opacity={0.2 + ((i*7)%10)*0.08} />;
        })}
      </g>
    );
  },
  function(c) {
    return (
      <g>
        <ellipse cx="100" cy="110" rx="65" ry="35" fill="none" stroke={c} strokeWidth="2" />
        <ellipse cx="100" cy="110" rx="34" ry="34" fill={c} opacity="0.7" />
        <circle cx="100" cy="110" r="13" fill="var(--cover-bg)" />
        <circle cx="108" cy="104" r="5" fill={c} />
      </g>
    );
  },
  function(c) {
    return (
      <g fill={c} stroke="var(--cover-bg)" strokeWidth="1">
        <polygon points="100,65 145,90 145,140 100,165 55,140 55,90" opacity="0.4" />
        <polygon points="100,65 145,90 100,115 55,90" opacity="0.7" />
        <polygon points="55,90 100,115 100,165 55,140" opacity="0.55" />
        <polygon points="145,90 100,115 100,165 145,140" />
      </g>
    );
  },
  function(c) {
    return (
      <g fill="none" stroke={c} strokeWidth="2.5">
        <circle cx="78" cy="100" r="38" opacity="0.65" />
        <circle cx="122" cy="100" r="38" opacity="0.65" />
        <circle cx="100" cy="132" r="38" opacity="0.65" />
      </g>
    );
  },
  function(c) {
    return (
      <g fill={c}>
        <rect x="40" y="65" width="120" height="16" />
        <rect x="40" y="95" width="82" height="10" opacity="0.7" />
        <rect x="40" y="119" width="100" height="10" opacity="0.55" />
        <rect x="40" y="143" width="62" height="10" opacity="0.4" />
        <circle cx="142" cy="155" r="22" opacity="0.3" />
      </g>
    );
  },
];

function ProceduralCover({ book, showMeta }) {
  var bg = spineColorFor(book);
  var fg = fgColorFor(book);
  var motifFn = MOTIFS[hashString((book.id || book.title) + "motif") % MOTIFS.length];
  return (
    <div style={{ width:"100%", height:"100%", background:bg, position:"relative", display:"flex", flexDirection:"column", overflow:"hidden", "--cover-bg":bg }}>
      <svg viewBox="0 0 200 300" preserveAspectRatio="xMidYMid meet" style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}>
        {motifFn(fg)}
      </svg>
      {showMeta && (
        <div style={{ marginTop:"auto", padding:"12px 14px 14px", position:"relative", zIndex:1, background:"linear-gradient(to top, rgba(0,0,0,0.5), transparent)" }}>
          <div style={{ fontFamily:FONT_MONO, fontSize:12, fontWeight:500, color:"#fff", lineHeight:1.25, marginBottom:6, letterSpacing:"-0.01em", wordBreak:"break-word" }}>{book.title}</div>
          <div style={{ fontFamily:FONT_MONO, fontSize:9, color:"rgba(255,255,255,0.8)", letterSpacing:"0.02em", textTransform:"uppercase" }}>{book.author}</div>
        </div>
      )}
    </div>
  );
}

function CoverImage({ book, showMetaOnFallback }) {
  var urls = getCoverUrls(book);
  var stateArr = useState(0);
  var urlIndex = stateArr[0];
  var setUrlIndex = stateArr[1];
  var loadedArr = useState(false);
  var realLoaded = loadedArr[0];
  var setRealLoaded = loadedArr[1];

  useEffect(function() { setUrlIndex(0); setRealLoaded(false); }, [book.id]);

  return (
    <div style={{ width:"100%", height:"100%", position:"relative" }}>
      <ProceduralCover book={book} showMeta={showMetaOnFallback && !realLoaded} />
      {urls[urlIndex] && (
        <img
          key={urls[urlIndex]}
          src={urls[urlIndex]}
          alt={book.title}
          style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", display:"block", opacity:realLoaded?1:0, transition:"opacity 0.3s ease" }}
          onLoad={function(e) {
            if (e.target.naturalWidth > 2 && e.target.naturalHeight > 2) setRealLoaded(true);
            else setUrlIndex(function(i) { return i + 1; });
          }}
          onError={function() { setUrlIndex(function(i) { return i + 1; }); }}
        />
      )}
    </div>
  );
}

// ── Star Rating ────────────────────────────────────────────────────────────

function StarRating({ value, onChange, size, allowHalf, readOnly }) {
  size = size || 20;
  allowHalf = allowHalf !== false;
  var hoverArr = useState(null);
  var hoverValue = hoverArr[0];
  var setHoverValue = hoverArr[1];
  var displayValue = hoverValue != null ? hoverValue : (value || 0);

  function starVal(i, isLeft) { return i + (isLeft && allowHalf ? 0.5 : 1); }

  return (
    <div style={{ display:"inline-flex", gap:2, alignItems:"center" }}>
      {[0,1,2,3,4].map(function(i) {
        var fillPct = Math.max(0, Math.min(1, displayValue - i));
        var gradId = "sg" + i + "_" + Math.random().toString(36).slice(2, 6);
        return (
          <span key={i} style={{ position:"relative", display:"inline-block", width:size, height:size, cursor:readOnly?"default":"pointer", lineHeight:0 }}>
            <svg width={size} height={size} viewBox="0 0 24 24" style={{ position:"absolute", inset:0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
                  <stop offset={fillPct*100+"%"} stopColor="#E63946" />
                  <stop offset={fillPct*100+"%"} stopColor="transparent" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" fill={"url(#"+gradId+")"} stroke="#E63946" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            {!readOnly && (
              <React.Fragment>
                <span style={{ position:"absolute", left:0, top:0, width:"50%", height:"100%", zIndex:1 }} onMouseEnter={function() { setHoverValue(starVal(i,true)); }} onMouseLeave={function() { setHoverValue(null); }} onClick={function() { onChange && onChange(starVal(i,true)); }} />
                <span style={{ position:"absolute", right:0, top:0, width:"50%", height:"100%", zIndex:1 }} onMouseEnter={function() { setHoverValue(starVal(i,false)); }} onMouseLeave={function() { setHoverValue(null); }} onClick={function() { onChange && onChange(starVal(i,false)); }} />
              </React.Fragment>
            )}
          </span>
        );
      })}
      {!readOnly && value > 0 && (
        <button onClick={function() { onChange && onChange(0); }} style={{ marginLeft:8, background:"transparent", border:"none", color:"#888", cursor:"pointer", fontSize:11, fontFamily:FONT_MONO }}>clear</button>
      )}
    </div>
  );
}

// ── Storage ────────────────────────────────────────────────────────────────

var SKEYS = { user: "shelved:currentUser", userId: "shelved:currentUserId", favs: "shelved:favGenres", justOnboarded: "shelved:justOnboarded" };

// Shared library lives in Supabase. Each book is a row.
// Username stays in localStorage (just identifies "you" within the shared library).

async function loadBooks() {
  try {
    const { data, error } = await supabase.from("books").select("data");
    if (error) throw error;
    return (data || []).map(function(row) { return row.data; });
  } catch(e) { console.error("loadBooks:", e); return []; }
}

async function saveBooks(books) {
  try {
    if (books.length > 0) {
      const rows = books.map(function(b) { return { id: b.id, data: b }; });
      const { error } = await supabase.from("books").upsert(rows);
      if (error) throw error;
    }
    const currentIds = books.map(function(b) { return b.id; });
    const { data: existing } = await supabase.from("books").select("id");
    const toDelete = (existing || [])
      .filter(function(r) { return currentIds.indexOf(r.id) === -1; })
      .map(function(r) { return r.id; });
    if (toDelete.length > 0) {
      await supabase.from("books").delete().in("id", toDelete);
    }
  } catch(e) { console.error("saveBooks:", e); }
}

async function loadUser() {
  try { return localStorage.getItem(SKEYS.user) || ""; } catch(e) { return ""; }
}
async function saveUser(name) { try { localStorage.setItem(SKEYS.user, name); } catch(e) {} }

async function loadUserId() {
  try { return localStorage.getItem(SKEYS.userId) || ""; } catch(e) { return ""; }
}
async function saveUserId(id) { try { localStorage.setItem(SKEYS.userId, id); } catch(e) {} }

// Hash a PIN with a fixed app salt so identical PINs don't collide in storage.
// Uses Web Crypto (available in all modern browsers).
async function hashPin(pin) {
  var encoder = new TextEncoder();
  var data = encoder.encode("shelved-v1-salt:" + pin);
  var buf = await crypto.subtle.digest("SHA-256", data);
  var bytes = new Uint8Array(buf);
  var hex = "";
  for (var i = 0; i < bytes.length; i++) {
    var h = bytes[i].toString(16);
    if (h.length < 2) h = "0" + h;
    hex += h;
  }
  return hex;
}

// Look up user by name (case-insensitive). Returns { id, name, pin_hash, fav_genres } or null.
async function findUserByName(name) {
  try {
    var { data, error } = await supabase
      .from("users")
      .select("id, name, pin_hash, fav_genres")
      .ilike("name", name.trim());
    if (error) throw error;
    return (data && data[0]) || null;
  } catch(e) { console.error("findUserByName:", e); return null; }
}

// Create a new user. Returns the new user row or throws on conflict.
async function createUser(name, pin, favGenres) {
  var pinHash = await hashPin(pin);
  try {
    var { data, error } = await supabase
      .from("users")
      .insert([{ name: name.trim(), pin_hash: pinHash, fav_genres: favGenres || [] }])
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch(e) {
    if (e && e.code === "23505") throw new Error("Name already taken");
    throw e;
  }
}

// Validate name + PIN against DB. Returns user row on success, null on failure.
async function authenticateUser(name, pin) {
  var user = await findUserByName(name);
  if (!user) return null;
  var hash = await hashPin(pin);
  if (hash !== user.pin_hash) return null;
  return user;
}

// Update the fav_genres on an existing user.
async function updateUserFavs(userId, favGenres) {
  try {
    var { error } = await supabase
      .from("users")
      .update({ fav_genres: favGenres || [] })
      .eq("id", userId);
    if (error) throw error;
  } catch(e) { console.error("updateUserFavs:", e); }
}

function loadFavs() {
  try { var v = localStorage.getItem(SKEYS.favs); return v ? JSON.parse(v) : []; } catch(e) { return []; }
}
function saveFavs(favs) { try { localStorage.setItem(SKEYS.favs, JSON.stringify(favs)); } catch(e) {} }

function loadJustOnboarded() {
  try { return localStorage.getItem(SKEYS.justOnboarded) === "1"; } catch(e) { return false; }
}
function setJustOnboarded(flag) {
  try {
    if (flag) localStorage.setItem(SKEYS.justOnboarded, "1");
    else localStorage.removeItem(SKEYS.justOnboarded);
  } catch(e) {}
}

// ── Backdrop ───────────────────────────────────────────────────────────────

function GradientBackdrop() {
  return (
    <div style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none", overflow:"hidden" }} aria-hidden="true">
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />
      <div className="blob blob-4" />
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────

export default function Shelved() {
  var booksArr = useState([]); var books = booksArr[0]; var setBooks = booksArr[1];
  var loadingArr = useState(true); var loading = loadingArr[0]; var setLoading = loadingArr[1];
  var userArr = useState(""); var currentUser = userArr[0]; var setCurrentUser = userArr[1];
  var userIdArr = useState(""); var currentUserId = userIdArr[0]; var setCurrentUserId = userIdArr[1];
  var umArr = useState({}); var userMap = umArr[0]; var setUserMap = umArr[1];
  var nameInputArr = useState(""); var nameInput = nameInputArr[0]; var setNameInput = nameInputArr[1];
  var showSearchArr = useState(false); var showSearch = showSearchArr[0]; var setShowSearch = showSearchArr[1];
  var showImportArr = useState(false); var showImport = showImportArr[0]; var setShowImport = showImportArr[1];
  var showRecsArr = useState(false); var showRecs = showRecsArr[0]; var setShowRecs = showRecsArr[1];
  var showNameEditArr = useState(false); var showNameEdit = showNameEditArr[0]; var setShowNameEdit = showNameEditArr[1];
  var selectedBookArr = useState(null); var selectedBook = selectedBookArr[0]; var setSelectedBook = selectedBookArr[1];
  var filterArr = useState("all"); var filter = filterArr[0]; var setFilter = filterArr[1];
  var genreFilterArr = useState(null); var genreFilter = genreFilterArr[0]; var setGenreFilter = genreFilterArr[1];
  var viewArr = useState("spines"); var view = viewArr[0]; var setView = viewArr[1];
  var favArr = useState([]); var favGenres = favArr[0]; var setFavGenres = favArr[1];
  var onboardStepArr = useState("name"); var onboardStep = onboardStepArr[0]; var setOnboardStep = onboardStepArr[1];
  var pulseArr = useState(false); var pulseForYou = pulseArr[0]; var setPulseForYou = pulseArr[1];

  useEffect(function() {
    Promise.all([loadBooks(), loadUser(), loadUserId(), loadAllUsers()]).then(function(res) {
      setBooks(res[0]);
      setCurrentUser(res[1]);
      setCurrentUserId(res[2]);
      var map = {};
      (res[3] || []).forEach(function(u) { map[u.id] = u.name; });
      setUserMap(map);
      setFavGenres(loadFavs());
      // Pulse For You until the user has rated at least one book
      var myRatings = (res[0] || []).filter(function(b) {
        return b.ratings && (b.ratings[res[2]] > 0 || b.ratings[res[1]] > 0);
      }).length;
      if (myRatings === 0) {
        setPulseForYou(true);
      }
      setJustOnboarded(false);
      setLoading(false);
      var m = window.location.hash.match(/^#book\/(.+)$/);
      if (m) {
        var found = res[0].find(function(x) { return x.id === decodeURIComponent(m[1]); });
        if (found) setSelectedBook(found);
      }
    });
  }, []);

  useEffect(function() {
    if (selectedBook) {
      var h = "#book/" + encodeURIComponent(selectedBook.id);
      if (window.location.hash !== h) window.history.replaceState(null, "", h);
    } else if (window.location.hash.indexOf("#book/") === 0) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [selectedBook]);

  async function handleAuth(user) {
    // Called after successful signup or login.
    saveFavs(user.fav_genres || []);
    setFavGenres(user.fav_genres || []);
    await saveUser(user.name);
    await saveUserId(user.id);
    setCurrentUser(user.name);
    setCurrentUserId(user.id);
    setUserMap(function(prev) { var next = Object.assign({}, prev); next[user.id] = user.name; return next; });
    setJustOnboarded(true);
    setPulseForYou(true);

    // Auto-claim: migrate any old string-keyed ratings/readers from books
    // where the old key matches this user's name. One-time per fresh login.
    var migrated = false;
    var newBooks = books.map(function(b) {
      var nb = Object.assign({}, b);
      var changed = false;
      if (b.readers && b.readers[user.name] !== undefined && !b.readers[user.id]) {
        nb.readers = Object.assign({}, b.readers);
        nb.readers[user.id] = nb.readers[user.name];
        changed = true;
      }
      if (b.ratings && b.ratings[user.name] !== undefined && !b.ratings[user.id]) {
        nb.ratings = Object.assign({}, b.ratings);
        nb.ratings[user.id] = nb.ratings[user.name];
        changed = true;
      }
      if (b.addedBy === user.name) { /* addedBy already matches name, no change needed */ }
      if (changed) { migrated = true; return nb; }
      return b;
    });
    if (migrated) {
      setBooks(newBooks);
      await saveBooks(newBooks);
    }
  }


  async function backfillGenres() {
    var untagged = books.filter(function(b) { return !b.genre; });
    if (untagged.length === 0) return { updated: 0 };
    var updated = 0;
    var working = books.slice();
    for (var i = 0; i < untagged.length; i++) {
      var b = untagged[i];
      var subjects = null;
      try {
        if (b.isbn) {
          var olRes = await fetch("https://openlibrary.org/isbn/" + b.isbn + ".json");
          if (olRes.ok) {
            var olData = await olRes.json();
            subjects = olData.subjects || null;
          }
        }
        if (!subjects) {
          var q = encodeURIComponent((b.title || "") + " " + (b.author || ""));
          var res = await fetch("https://openlibrary.org/search.json?q=" + q + "&limit=1&fields=subject");
          if (res.ok) {
            var data = await res.json();
            if (data.docs && data.docs[0] && data.docs[0].subject) {
              subjects = data.docs[0].subject;
            }
          }
        }
        if (!subjects) {
          var q2 = encodeURIComponent((b.title || "") + " " + (b.author || ""));
          var gres = await fetch("https://www.googleapis.com/books/v1/volumes?q=" + q2 + "&maxResults=1&fields=items(volumeInfo(categories))");
          if (gres.ok) {
            var gdata = await gres.json();
            if (gdata.items && gdata.items[0] && gdata.items[0].volumeInfo && gdata.items[0].volumeInfo.categories) {
              subjects = gdata.items[0].volumeInfo.categories;
            }
          }
        }
      } catch(e) { /* ignore per-book errors */ }
      var genre = classifyGenre(subjects);
      if (genre) {
        var idx = working.findIndex(function(x) { return x.id === b.id; });
        if (idx !== -1) {
          working[idx] = Object.assign({}, working[idx], { genre: genre });
          updated++;
        }
      }
    }
    setBooks(working);
    await saveBooks(working);
    return { updated: updated, total: untagged.length };
  }

  async function addBook(bookData, status, rating) {
    var key = currentUserId || currentUser; // prefer user UUID
    var existing = books.find(function(b) { return b.id === bookData.id; });
    if (existing) {
      var readers2 = Object.assign({}, existing.readers); readers2[key] = status;
      var ratings2 = Object.assign({}, existing.ratings || {});
      if (rating != null && rating > 0) ratings2[key] = rating;
      var upd2 = books.map(function(b) { return b.id === bookData.id ? Object.assign({}, b, { readers: readers2, ratings: ratings2 }) : b; });
      setBooks(upd2); await saveBooks(upd2); return;
    }
    var newBook = Object.assign({}, bookData, { addedBy: currentUser, addedByUserId: currentUserId, addedAt: Date.now(), readers: {}, ratings: {}, reviews: [] });
    newBook.readers[key] = status;
    if (rating != null && rating > 0) newBook.ratings[key] = rating;
    var upd = [newBook].concat(books);
    setBooks(upd); await saveBooks(upd);
  }

  async function importBooks(incoming) {
    var byId = new Map(books.map(function(b) { return [b.id, b]; }));
    var added = 0, merged = 0;
    var newBookIds = [];

    // Merge into byId (no genre fetching yet — that happens async after save)
    for (var ri = 0; ri < incoming.length; ri++) {
      var row = incoming[ri];
      var ex = byId.get(row.id);
      if (ex) {
        var r2 = Object.assign({}, ex.readers); var uKey = currentUserId || currentUser;
        if (row.status) r2[uKey] = row.status;
        var rt2 = Object.assign({}, ex.ratings || {}); if (row.rating > 0) rt2[uKey] = row.rating;
        byId.set(row.id, Object.assign({}, ex, { readers: r2, ratings: rt2 }));
        merged++;
      } else {
        var uKey2 = currentUserId || currentUser;
        var nb = { id:row.id, title:row.title, author:row.author, year:row.year||null, coverId:null, isbn:row.isbn||null, googleThumb:null, genre:null, addedBy:currentUser, addedByUserId:currentUserId, addedAt:Date.now(), readers:{}, ratings:{}, reviews:[] };
        if (row.status) nb.readers[uKey2] = row.status;
        if (row.rating > 0) nb.ratings[uKey2] = row.rating;
        byId.set(row.id, nb);
        newBookIds.push(row.id);
        added++;
      }
    }

    // Save immediately — don't make the user wait on external APIs.
    var upd = Array.from(byId.values());
    setBooks(upd);
    await saveBooks(upd);

    // Fire-and-forget background genre enrichment. User can see their library
    // immediately; genres appear as they're classified. Users can also manually
    // tag via the book detail view or "Tag genres" button in header.
    setTimeout(function() { enrichGenresInBackground(newBookIds); }, 100);

    return { added: added, merged: merged };
  }

  async function enrichGenresInBackground(bookIds) {
    // Per-fetch timeout wrapper — 4 seconds max per API call.
    function fetchWithTimeout(url) {
      return Promise.race([
        fetch(url),
        new Promise(function(_, rej) { setTimeout(function() { rej(new Error("timeout")); }, 4000); })
      ]);
    }

    async function fetchGenre(b) {
      try {
        if (b.isbn) {
          var r1 = await fetchWithTimeout("https://openlibrary.org/isbn/" + b.isbn + ".json");
          if (r1.ok) {
            var d1 = await r1.json();
            var g = classifyGenre(d1.subjects);
            if (g) return g;
          }
        }
        var q = encodeURIComponent((b.title || "") + " " + (b.author || ""));
        var r2 = await fetchWithTimeout("https://openlibrary.org/search.json?q=" + q + "&limit=1&fields=subject");
        if (r2.ok) {
          var d2 = await r2.json();
          if (d2.docs && d2.docs[0]) {
            var g2 = classifyGenre(d2.docs[0].subject);
            if (g2) return g2;
          }
        }
      } catch(e) { /* skip on timeout/error */ }
      return null;
    }

    // Process sequentially to avoid hammering Open Library
    for (var i = 0; i < bookIds.length; i++) {
      // Re-read latest books state each iteration; book may have been edited
      var idx = -1;
      for (var k = 0; k < books.length; k++) {
        if (books[k].id === bookIds[i]) { idx = k; break; }
      }
      // books here is stale from closure — use a fresh read via setBooks updater
      // This pattern uses the functional setter to get current state:
      var genre = null;
      try {
        var bookNow = null;
        setBooks(function(prev) {
          bookNow = prev.find(function(x) { return x.id === bookIds[i]; });
          return prev;
        });
        if (!bookNow || bookNow.genre) continue; // already tagged or gone
        genre = await fetchGenre(bookNow);
      } catch(e) { continue; }

      if (genre) {
        // Update state + persist using functional setter
        var newList = null;
        setBooks(function(prev) {
          newList = prev.map(function(x) { return x.id === bookIds[i] ? Object.assign({}, x, { genre: genre }) : x; });
          return newList;
        });
        if (newList) {
          try { await saveBooks(newList); } catch(e) { /* skip */ }
        }
      }
      // Small delay between requests to be polite
      await new Promise(function(r) { setTimeout(r, 150); });
    }
  }

  async function updateBook(bookId, updater) {
    var upd = books.map(function(b) { return b.id === bookId ? updater(b) : b; });
    setBooks(upd); await saveBooks(upd);
    if (selectedBook && selectedBook.id === bookId) setSelectedBook(upd.find(function(b) { return b.id === bookId; }));
  }

  async function removeBook(bookId) {
    var upd = books.filter(function(b) { return b.id !== bookId; });
    setBooks(upd); await saveBooks(upd); setSelectedBook(null);
  }

  async function renameUser(newName) {
    var trimmed = newName.trim();
    if (!trimmed || trimmed === currentUser) return;
    // Check availability
    var existing = await findUserByName(trimmed);
    if (existing && existing.id !== currentUserId) {
      alert("That name is already taken.");
      return;
    }
    try {
      var { error } = await supabase.from("users").update({ name: trimmed }).eq("id", currentUserId);
      if (error) throw error;
    } catch(e) { alert("Could not update name."); return; }
    var old = currentUser;
    var upd = books.map(function(b) {
      var n = Object.assign({}, b);
      if (b.addedBy === old) n.addedBy = trimmed;
      if (Array.isArray(b.reviews)) {
        n.reviews = b.reviews.map(function(rv) { return rv.author === old ? Object.assign({}, rv, { author: trimmed }) : rv; });
      }
      return n;
    });
    await saveUser(trimmed); setBooks(upd); await saveBooks(upd); setCurrentUser(trimmed);
  }

  function userHasRead(b) {
    if (!b.readers) return false;
    if (currentUserId && b.readers[currentUserId]) return true;
    if (currentUser && b.readers[currentUser]) return true;
    return false;
  }
  function isMyBook(b) {
    if (currentUserId && b.addedByUserId === currentUserId) return true;
    if (currentUser && b.addedBy === currentUser) return true;
    return false;
  }
  var filteredBooks = books.filter(function(b) {
    if (filter === "mine" && !userHasRead(b)) return false;
    if (filter === "circle" && isMyBook(b)) return false;
    if (filter !== "all" && filter !== "mine" && filter !== "circle" && Object.values(b.readers || {}).indexOf(filter) === -1) return false;
    if (genreFilter && genreForBook(b) !== genreFilter) return false;
    return true;
  });

  var genreCounts = books.reduce(function(acc, b) {
    var g = genreForBook(b); if (g) acc[g] = (acc[g] || 0) + 1; return acc;
  }, {});

  var counts = {
    all: books.length,
    mine: books.filter(userHasRead).length,
    circle: books.filter(function(b) { return !isMyBook(b); }).length,
    reading: books.filter(function(b) { return Object.values(b.readers||{}).indexOf("reading") !== -1; }).length,
    read: books.filter(function(b) { return Object.values(b.readers||{}).indexOf("read") !== -1; }).length,
    want: books.filter(function(b) { return Object.values(b.readers||{}).indexOf("want") !== -1; }).length,
  };

  if (!loading && !currentUserId) {
    return <AuthFlow onAuthed={handleAuth} />;
  }

  return (
    <div style={{ minHeight:"100vh", background:BG, fontFamily:FONT_SANS, color:INK, position:"relative", overflowX:"hidden" }}>
      <GradientBackdrop />
      <Header user={currentUser} bookCount={books.length} untaggedCount={books.filter(function(b) { return !b.genre; }).length} pulseForYou={pulseForYou} onAdd={function() { setShowSearch(true); }} onImport={function() { setShowImport(true); }} onRecs={function() { setShowRecs(true); setPulseForYou(false); }} onEditName={function() { setShowNameEdit(true); }} onBackfill={backfillGenres} />
      <FilterBar filter={filter} setFilter={setFilter} view={view} setView={setView} genreFilter={genreFilter} setGenreFilter={setGenreFilter} genreCounts={genreCounts} counts={counts} />
      {loading ? (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, padding:120, color:MUTED, fontSize:13, fontFamily:FONT_MONO }}><Loader2 size={18} className="spin" /><span>Loading</span></div>
      ) : filteredBooks.length === 0 ? (
        <EmptyState onAdd={function() { setShowSearch(true); }} filter={filter} />
      ) : view === "stack" ? (
        <StackView books={filteredBooks} onSelect={setSelectedBook} onAdd={function() { setShowSearch(true); }} />
      ) : filter === "circle" ? (
        <CircleView books={filteredBooks} userMap={userMap} onSelect={setSelectedBook} />
      ) : (
        <SpineGrid books={filteredBooks} onSelect={setSelectedBook} onAdd={function() { setShowSearch(true); }} />
      )}
      {showSearch && <SearchOverlay onClose={function() { setShowSearch(false); }} onAdd={async function(bd, st, rt) { await addBook(bd, st, rt); }} existingIds={new Set(books.map(function(b) { return b.id; }))} />}
      {showImport && <ImportModal onClose={function() { setShowImport(false); }} onImport={importBooks} />}
      {showRecs && <RecsModal books={books} currentUser={currentUser} currentUserId={currentUserId} userMap={userMap} favGenres={favGenres} onClose={function() { setShowRecs(false); }} onSelect={function(bk) { setShowRecs(false); setSelectedBook(bk); }} />}
      {showNameEdit && <NameEditModal currentName={currentUser} onClose={function() { setShowNameEdit(false); }} onSave={async function(n) { await renameUser(n); setShowNameEdit(false); }} />}
      {selectedBook && <BookDetail book={selectedBook} currentUser={currentUser} currentUserId={currentUserId} userMap={userMap} onClose={function() { setSelectedBook(null); }} onUpdate={updateBook} onRemove={removeBook} />}
      <style>{GLOBAL_CSS}</style>
    </div>
  );
}

// ── Onboarding ─────────────────────────────────────────────────────────────

function AuthFlow({ onAuthed }) {
  // modes: "choose" | "signin" | "signup-name" | "signup-pin" | "signup-genres"
  var modeArr = useState("choose"); var mode = modeArr[0]; var setMode = modeArr[1];
  var nameArr = useState(""); var name = nameArr[0]; var setName = nameArr[1];
  var pinArr = useState(""); var pin = pinArr[0]; var setPin = pinArr[1];
  var favsArr = useState([]); var favs = favsArr[0]; var setFavs = favsArr[1];
  var errArr = useState(""); var error = errArr[0]; var setError = errArr[1];
  var busyArr = useState(false); var busy = busyArr[0]; var setBusy = busyArr[1];

  async function doSignin() {
    setError("");
    if (!name.trim()) { setError("Enter your name"); return; }
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { setError("PIN must be 4 digits"); return; }
    setBusy(true);
    try {
      var user = await authenticateUser(name, pin);
      if (!user) { setError("Name or PIN is incorrect"); setBusy(false); return; }
      await onAuthed(user);
    } catch(e) { setError("Something went wrong"); setBusy(false); }
  }

  async function doSignupCheck() {
    setError("");
    if (!name.trim()) { setError("Enter your name"); return; }
    setBusy(true);
    try {
      var existing = await findUserByName(name);
      if (existing) {
        setError("That name is taken. If it's yours, tap Sign in.");
        setBusy(false); return;
      }
      setMode("signup-pin");
      setBusy(false);
    } catch(e) { setError("Something went wrong"); setBusy(false); }
  }

  function proceedToGenres() {
    setError("");
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { setError("Pick a 4-digit PIN"); return; }
    setMode("signup-genres");
  }

  async function doSignup(selectedFavs) {
    setBusy(true);
    try {
      var user = await createUser(name, pin, selectedFavs || []);
      await onAuthed(user);
    } catch(e) {
      setError(e.message || "Could not create account");
      setBusy(false);
    }
  }

  var wrapStyle = { minHeight:"100vh", background:BG, display:"flex", alignItems:"center", justifyContent:"center", padding:"32px 20px", fontFamily:FONT_SANS };
  var cardStyle = { maxWidth:520, width:"100%", textAlign:"center" };

  // ── Choose mode ────────────────────────────────────────────────────────
  if (mode === "choose") {
    return (
      <div style={wrapStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize:32, color:"#E63946", marginBottom:24, fontFamily:FONT_SERIF }}>✦</div>
          <h1 style={{ fontFamily:FONT_DISPLAY, fontSize:"clamp(56px,12vw,120px)", fontWeight:400, letterSpacing:"-0.04em", lineHeight:0.95, margin:"0 0 16px 0", color:INK }}>
            Shelved<span style={{ color:"#E63946" }}>.</span>
          </h1>
          <p style={{ fontFamily:FONT_SERIF, fontSize:"clamp(16px,2.5vw,20px)", fontStyle:"italic", color:MUTED, margin:"0 0 40px 0", fontWeight:400 }}>A private library for a closed circle of readers.</p>
          <div style={{ display:"flex", gap:10, flexDirection:"column", maxWidth:320, margin:"0 auto" }}>
            <button style={{ padding:"14px 24px", background:INK, color:BG, border:"none", borderRadius:999, fontSize:14, cursor:"pointer", fontFamily:FONT_SANS, fontWeight:500 }} onClick={function() { setMode("signup-name"); setError(""); }}>
              I'm new here
            </button>
            <button style={{ padding:"14px 24px", background:"transparent", color:INK, border:"1px solid "+RULE, borderRadius:999, fontSize:14, cursor:"pointer", fontFamily:FONT_SANS, fontWeight:500 }} onClick={function() { setMode("signin"); setError(""); }}>
              I already have an account
            </button>
          </div>
        </div>
        <style>{GLOBAL_CSS}</style>
      </div>
    );
  }

  // ── Sign in: name + pin ────────────────────────────────────────────────
  if (mode === "signin") {
    return (
      <div style={wrapStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize:24, color:"#E63946", marginBottom:16, fontFamily:FONT_SERIF }}>✦</div>
          <h1 style={{ fontFamily:FONT_DISPLAY, fontSize:"clamp(36px,7vw,64px)", fontWeight:400, letterSpacing:"-0.035em", lineHeight:1.0, margin:"0 0 14px" }}>
            Welcome <em>back</em>
          </h1>
          <p style={{ fontFamily:FONT_SERIF, fontSize:"clamp(14px,2.4vw,17px)", fontStyle:"italic", color:MUTED, margin:"0 0 32px" }}>
            Your name and 4-digit PIN.
          </p>
          <div style={{ display:"flex", flexDirection:"column", gap:10, maxWidth:320, margin:"0 auto" }}>
            <input style={{ padding:"14px 18px", fontSize:15, border:"1px solid "+RULE_SOFT, borderRadius:999, background:"transparent", fontFamily:FONT_SANS, color:INK, outline:"none", textAlign:"center" }} placeholder="Your name" value={name} onChange={function(e) { setName(e.target.value); }} autoFocus />
            <input type="tel" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" style={{ padding:"14px 18px", fontSize:22, letterSpacing:"0.5em", border:"1px solid "+RULE_SOFT, borderRadius:999, background:"transparent", fontFamily:FONT_MONO, color:INK, outline:"none", textAlign:"center" }} placeholder="PIN" value={pin} onChange={function(e) { setPin(e.target.value.replace(/[^0-9]/g,"").slice(0,4)); }} onKeyDown={function(e) { if (e.key === "Enter") doSignin(); }} />
            {error && <div style={{ fontFamily:FONT_SERIF, fontSize:13, fontStyle:"italic", color:"#C62828", padding:"4px 0" }}>{error}</div>}
            <button style={{ padding:"14px 24px", background:INK, color:BG, border:"none", borderRadius:999, fontSize:14, cursor:"pointer", fontFamily:FONT_SANS, fontWeight:500, opacity:busy?0.6:1 }} disabled={busy} onClick={doSignin}>
              {busy ? "Checking..." : "Sign in →"}
            </button>
            <button style={{ padding:"8px", background:"transparent", border:"none", color:MUTED, fontFamily:FONT_SERIF, fontSize:13, fontStyle:"italic", cursor:"pointer" }} onClick={function() { setMode("choose"); setError(""); }}>
              ← Back
            </button>
          </div>
        </div>
        <style>{GLOBAL_CSS}</style>
      </div>
    );
  }

  // ── Signup name step ───────────────────────────────────────────────────
  if (mode === "signup-name") {
    return (
      <div style={wrapStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize:24, color:"#E63946", marginBottom:16, fontFamily:FONT_SERIF }}>✦</div>
          <h1 style={{ fontFamily:FONT_DISPLAY, fontSize:"clamp(36px,7vw,64px)", fontWeight:400, letterSpacing:"-0.035em", lineHeight:1.0, margin:"0 0 14px" }}>
            What should we <em>call you</em>?
          </h1>
          <p style={{ fontFamily:FONT_SERIF, fontSize:"clamp(14px,2.4vw,17px)", fontStyle:"italic", color:MUTED, margin:"0 0 32px" }}>
            Your circle will see this name on your ratings and reviews.
          </p>
          <div style={{ display:"flex", flexDirection:"column", gap:10, maxWidth:320, margin:"0 auto" }}>
            <input style={{ padding:"14px 18px", fontSize:15, border:"1px solid "+RULE_SOFT, borderRadius:999, background:"transparent", fontFamily:FONT_SANS, color:INK, outline:"none", textAlign:"center" }} placeholder="Your name" value={name} onChange={function(e) { setName(e.target.value); }} onKeyDown={function(e) { if (e.key === "Enter") doSignupCheck(); }} autoFocus />
            {error && <div style={{ fontFamily:FONT_SERIF, fontSize:13, fontStyle:"italic", color:"#C62828", padding:"4px 0" }}>{error}</div>}
            <button style={{ padding:"14px 24px", background:INK, color:BG, border:"none", borderRadius:999, fontSize:14, cursor:"pointer", fontFamily:FONT_SANS, fontWeight:500, opacity:busy?0.6:1 }} disabled={busy} onClick={doSignupCheck}>
              {busy ? "Checking..." : "Continue →"}
            </button>
            <button style={{ padding:"8px", background:"transparent", border:"none", color:MUTED, fontFamily:FONT_SERIF, fontSize:13, fontStyle:"italic", cursor:"pointer" }} onClick={function() { setMode("choose"); setError(""); }}>
              ← Back
            </button>
          </div>
        </div>
        <style>{GLOBAL_CSS}</style>
      </div>
    );
  }

  // ── Signup PIN step ────────────────────────────────────────────────────
  if (mode === "signup-pin") {
    return (
      <div style={wrapStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize:24, color:"#E63946", marginBottom:16, fontFamily:FONT_SERIF }}>✦</div>
          <h1 style={{ fontFamily:FONT_DISPLAY, fontSize:"clamp(36px,7vw,64px)", fontWeight:400, letterSpacing:"-0.035em", lineHeight:1.0, margin:"0 0 14px" }}>
            Choose a <em>4-digit PIN</em>
          </h1>
          <p style={{ fontFamily:FONT_SERIF, fontSize:"clamp(14px,2.4vw,17px)", fontStyle:"italic", color:MUTED, margin:"0 0 32px" }}>
            You'll use this to sign in on other devices. Pick something memorable — there's no reset.
          </p>
          <div style={{ display:"flex", flexDirection:"column", gap:10, maxWidth:320, margin:"0 auto" }}>
            <input type="tel" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" style={{ padding:"14px 18px", fontSize:28, letterSpacing:"0.5em", border:"1px solid "+RULE_SOFT, borderRadius:999, background:"transparent", fontFamily:FONT_MONO, color:INK, outline:"none", textAlign:"center" }} placeholder="••••" value={pin} onChange={function(e) { setPin(e.target.value.replace(/[^0-9]/g,"").slice(0,4)); }} onKeyDown={function(e) { if (e.key === "Enter" && pin.length === 4) proceedToGenres(); }} autoFocus />
            {error && <div style={{ fontFamily:FONT_SERIF, fontSize:13, fontStyle:"italic", color:"#C62828", padding:"4px 0" }}>{error}</div>}
            <button style={{ padding:"14px 24px", background:INK, color:BG, border:"none", borderRadius:999, fontSize:14, cursor:"pointer", fontFamily:FONT_SANS, fontWeight:500, opacity:pin.length!==4?0.5:1 }} disabled={pin.length !== 4} onClick={proceedToGenres}>
              Continue →
            </button>
            <button style={{ padding:"8px", background:"transparent", border:"none", color:MUTED, fontFamily:FONT_SERIF, fontSize:13, fontStyle:"italic", cursor:"pointer" }} onClick={function() { setMode("signup-name"); setError(""); }}>
              ← Back
            </button>
          </div>
        </div>
        <style>{GLOBAL_CSS}</style>
      </div>
    );
  }

  // ── Signup genres step (final) ─────────────────────────────────────────
  if (mode === "signup-genres") {
    return (
      <div style={wrapStyle}>
        <GenreOnboardingInner busy={busy} error={error} onSubmit={doSignup} />
      </div>
    );
  }

  return null;
}

function GenreOnboardingInner({ onSubmit, busy, error }) {
  var selArr = useState([]); var selected = selArr[0]; var setSelected = selArr[1];
  function toggle(g) {
    if (selected.indexOf(g) !== -1) setSelected(selected.filter(function(x) { return x !== g; }));
    else if (selected.length < 3) setSelected(selected.concat([g]));
  }
  return (
    <div style={{ maxWidth:640, width:"100%", textAlign:"center" }}>
      <div style={{ fontSize:24, color:"#E63946", marginBottom:16, fontFamily:FONT_SERIF }}>✦</div>
      <h1 style={{ fontFamily:FONT_DISPLAY, fontSize:"clamp(36px,7vw,64px)", fontWeight:400, letterSpacing:"-0.035em", lineHeight:1.0, margin:"0 0 14px" }}>
        What do you <em>love</em> to read?
      </h1>
      <p style={{ fontFamily:FONT_SERIF, fontSize:"clamp(14px,2.4vw,17px)", fontStyle:"italic", color:MUTED, margin:"0 0 32px", fontWeight:400 }}>
        Pick up to three. We'll tune your recommendations.
      </p>
      <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", marginBottom:28 }}>
        {GENRES.filter(function(g) { return g !== "Other"; }).map(function(g) {
          var active = selected.indexOf(g) !== -1;
          var disabled = !active && selected.length >= 3;
          return (
            <button key={g}
              onClick={function() { toggle(g); }}
              disabled={disabled}
              style={{
                padding:"10px 18px",
                background: active ? INK : "transparent",
                color: active ? BG : (disabled ? RULE : INK),
                border: "1px solid " + (active ? INK : (disabled ? RULE_SOFT : RULE)),
                borderRadius: 999, fontSize: 14,
                cursor: disabled ? "default" : "pointer",
                fontFamily: FONT_SANS, fontWeight: 500,
                opacity: disabled ? 0.5 : 1,
                transition: "all 0.15s ease",
              }}>
              {active && "✓ "}{g}
            </button>
          );
        })}
      </div>
      {error && <div style={{ fontFamily:FONT_SERIF, fontSize:13, fontStyle:"italic", color:"#C62828", marginBottom:12 }}>{error}</div>}
      <div style={{ display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap" }}>
        <button disabled={busy} style={{ padding:"14px 24px", background:"transparent", color:MUTED, border:"1px solid "+RULE_SOFT, borderRadius:999, fontSize:14, cursor:"pointer", fontFamily:FONT_SANS, fontWeight:500, opacity:busy?0.6:1 }}
          onClick={function() { onSubmit([]); }}>
          Skip for now
        </button>
        <button disabled={busy || selected.length === 0} style={{ padding:"14px 28px", background:INK, color:BG, border:"none", borderRadius:999, fontSize:14, cursor:"pointer", fontFamily:FONT_SANS, fontWeight:500, opacity:(busy||selected.length===0)?0.5:1 }}
          onClick={function() { onSubmit(selected); }}>
          {busy ? "Creating..." : (selected.length === 0 ? "Pick at least one" : "Finish →")}
        </button>
      </div>
      <style>{GLOBAL_CSS}</style>
    </div>
  );
}



function GenreOnboarding({ onSubmit }) {
  var selArr = useState([]); var selected = selArr[0]; var setSelected = selArr[1];

  function toggle(g) {
    if (selected.indexOf(g) !== -1) {
      setSelected(selected.filter(function(x) { return x !== g; }));
    } else if (selected.length < 3) {
      setSelected(selected.concat([g]));
    }
  }

  return (
    <div style={{ minHeight:"100vh", background:BG, display:"flex", alignItems:"center", justifyContent:"center", padding:"32px 20px", fontFamily:FONT_SANS }}>
      <div style={{ maxWidth:640, width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:24, color:"#E63946", marginBottom:16, fontFamily:FONT_SERIF }}>✦</div>
        <h1 style={{ fontFamily:FONT_DISPLAY, fontSize:"clamp(36px,7vw,64px)", fontWeight:400, letterSpacing:"-0.035em", lineHeight:1.0, margin:"0 0 14px" }}>
          What do you <em>love</em> to read?
        </h1>
        <p style={{ fontFamily:FONT_SERIF, fontSize:"clamp(14px,2.4vw,17px)", fontStyle:"italic", color:MUTED, margin:"0 0 32px", fontWeight:400 }}>
          Pick up to three. We'll use this to tune your recommendations.
        </p>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", marginBottom:36 }}>
          {GENRES.filter(function(g) { return g !== "Other"; }).map(function(g) {
            var active = selected.indexOf(g) !== -1;
            var disabled = !active && selected.length >= 3;
            return (
              <button key={g}
                onClick={function() { toggle(g); }}
                disabled={disabled}
                style={{
                  padding:"10px 18px",
                  background: active ? INK : "transparent",
                  color: active ? BG : (disabled ? RULE : INK),
                  border: "1px solid " + (active ? INK : (disabled ? RULE_SOFT : RULE)),
                  borderRadius: 999,
                  fontSize: 14,
                  cursor: disabled ? "default" : "pointer",
                  fontFamily: FONT_SANS,
                  fontWeight: 500,
                  opacity: disabled ? 0.5 : 1,
                  transition: "all 0.15s ease",
                }}>
                {active && "✓ "}{g}
              </button>
            );
          })}
        </div>
        <div style={{ display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap" }}>
          <button style={{ padding:"14px 24px", background:"transparent", color:MUTED, border:"1px solid "+RULE_SOFT, borderRadius:999, fontSize:14, cursor:"pointer", fontFamily:FONT_SANS, fontWeight:500 }}
            onClick={function() { onSubmit([]); }}>
            Skip for now
          </button>
          <button style={{ padding:"14px 28px", background:INK, color:BG, border:"none", borderRadius:999, fontSize:14, cursor:"pointer", fontFamily:FONT_SANS, fontWeight:500, opacity:selected.length===0?0.5:1 }}
            disabled={selected.length === 0}
            onClick={function() { onSubmit(selected); }}>
            {selected.length === 0 ? "Pick at least one" : "Continue →"}
          </button>
        </div>
      </div>
      <style>{GLOBAL_CSS}</style>
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────

function Header({ user, bookCount, untaggedCount, pulseForYou, onAdd, onImport, onRecs, onEditName, onBackfill }) {
  var backArr = useState("idle"); var backState = backArr[0]; var setBackState = backArr[1];
  var resArr = useState(null); var backResult = resArr[0]; var setBackResult = resArr[1];
  async function doBackfill() {
    setBackState("running");
    try {
      var r = await onBackfill();
      setBackResult(r); setBackState("done");
      setTimeout(function() { setBackState("idle"); setBackResult(null); }, 3000);
    } catch(e) { setBackState("idle"); }
  }
  return (
    <header style={{ padding:"24px clamp(16px, 4vw, 48px) 36px", borderBottom:"1px solid "+RULE, position:"relative", zIndex:1 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"clamp(28px, 6vw, 64px)", gap:16, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:16, flexWrap:"wrap" }}>
          <div style={{ display:"flex", flexDirection:"column", gap:1, lineHeight:1 }}>
            <span style={{ fontFamily:FONT_DISPLAY, fontSize:22, fontWeight:500, letterSpacing:"-0.02em" }}>
              Shelved<span style={{ color:"#E63946" }}>.</span>
            </span>
            <span style={{ fontFamily:FONT_MONO, fontSize:7, color:MUTED, letterSpacing:"0.12em", textTransform:"uppercase", opacity:0.75 }}>
              by artyfartybob
            </span>
          </div>
          <span style={{ fontFamily:FONT_MONO, fontSize:10, color:MUTED, letterSpacing:"0.08em", textTransform:"uppercase" }}>
            {String(bookCount).padStart(3,"0")} volumes &middot;{" "}
            <button className="nameBtn" style={{ background:"transparent", border:"none", padding:0, color:MUTED, fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.08em", textTransform:"uppercase", cursor:"pointer", borderBottom:"1px dotted "+MUTED }} onClick={onEditName}>{user}</button>
          </span>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <button style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 16px", background:"transparent", color:INK, border:"1px solid "+RULE, borderRadius:999, fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:FONT_SANS }} onClick={onImport}>
            <Upload size={14} strokeWidth={2} /> Import
          </button>
          <button style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 18px", background:INK, color:BG, border:"none", borderRadius:999, fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:FONT_SANS }} onClick={onAdd}>
            <Plus size={14} strokeWidth={2.5} /> Add a book
          </button>
        </div>
      </div>
      <h1 style={{ fontFamily:FONT_DISPLAY, fontSize:"clamp(36px,7vw,96px)", fontWeight:400, lineHeight:1.05, letterSpacing:"-0.035em", margin:"0 0 32px", textAlign:"left" }}>
        A library, <em>shared</em>.<br />Everything we've read, <em>together</em>.
      </h1>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:16, paddingTop:32, borderTop:"1px solid "+RULE_SOFT }}>
        <div style={{ maxWidth:500 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
            <Sparkles size={14} strokeWidth={2} style={{ color:"#E63946", flexShrink:0 }} />
            <span style={{ fontFamily:FONT_MONO, fontSize:10, color:"#E63946", letterSpacing:"0.15em", textTransform:"uppercase" }}>For you</span>
          </div>
          <p style={{ fontFamily:FONT_SERIF, fontSize:16, fontStyle:"italic", color:MUTED, margin:0, lineHeight:1.5, letterSpacing:"-0.01em" }}>
            Rate a few books and we'll find what your circle loved that you haven't read yet.
          </p>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {untaggedCount > 0 && (
            <button title={"Tag " + untaggedCount + " books with genres"}
              disabled={backState==="running"}
              style={{ display:"flex", alignItems:"center", gap:6, padding:"12px 18px", background:"transparent", color:INK, border:"1px solid "+RULE, borderRadius:999, fontSize:13, fontWeight:500, cursor:backState==="running"?"default":"pointer", fontFamily:FONT_SANS, flexShrink:0, opacity:backState==="running"?0.6:1 }}
              onClick={doBackfill}>
              {backState==="running" ? <Loader2 size={14} className="spin" /> : backState==="done" ? <Check size={14} strokeWidth={2.2} /> : <Wand2 size={14} strokeWidth={2} />}
              {backState==="running" ? "Tagging..." : backState==="done" ? (backResult ? "Tagged " + backResult.updated : "Done") : "Tag genres (" + untaggedCount + ")"}
            </button>
          )}
          <button className={pulseForYou ? "forYouPulse" : ""} style={{ display:"flex", alignItems:"center", gap:8, padding:"12px 22px", background:"#E63946", color:"#FBF6EA", border:"none", borderRadius:999, fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:FONT_SANS, flexShrink:0, boxShadow:"0 3px 12px rgba(230,57,70,0.28)" }} onClick={onRecs}>
            <Sparkles size={14} strokeWidth={2} /> Get recommendations
          </button>
        </div>
      </div>
    </header>
  );
}

// ── Filter Bar ─────────────────────────────────────────────────────────────

function FilterBar({ filter, setFilter, view, setView, counts, genreFilter, setGenreFilter, genreCounts }) {
  var filters = [
    { k:"all", label:"All" }, { k:"mine", label:"Mine" }, { k:"circle", label:"Circle" },
    { k:"reading", label:"Reading" }, { k:"read", label:"Finished" }, { k:"want", label:"Wishlist" },
  ];
  var activeGenres = GENRES.filter(function(g) { return (genreCounts[g] || 0) > 0; })
    .sort(function(a,b) { return (genreCounts[b]||0) - (genreCounts[a]||0); });

  return (
    <div style={{ borderBottom:"1px solid "+RULE, position:"relative", zIndex:50 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"16px clamp(16px, 4vw, 48px) 10px", gap:16, flexWrap:"nowrap" }}>
        <div className="chipScroll" style={{ display:"flex", gap:4, alignItems:"center", overflowX:"auto", flex:1, minWidth:0 }}>
          {filters.map(function(f) {
            var active = filter === f.k;
            return (
              <button key={f.k} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 14px", background:active?INK:"transparent", color:active?BG:MUTED, border:"none", borderRadius:999, fontSize:13, cursor:"pointer", fontFamily:FONT_SANS, fontWeight:500, flexShrink:0 }} onClick={function() { setFilter(f.k); }}>
                <span>{f.label}</span><span style={{ fontFamily:FONT_MONO, fontSize:10, opacity:0.6 }}>{counts[f.k]}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display:"flex", padding:3, background:"rgba(14,14,14,0.06)", borderRadius:999, flexShrink:0 }}>
          <button title="Spines" style={{ padding:"7px 12px", background:view==="spines"?BG:"transparent", color:view==="spines"?INK:MUTED, border:"none", borderRadius:999, cursor:"pointer", display:"flex", alignItems:"center", boxShadow:view==="spines"?"0 1px 3px rgba(0,0,0,0.08)":"none" }} onClick={function() { setView("spines"); }}>
            <AlignLeft size={15} strokeWidth={2} />
          </button>
          <button title="Stack" style={{ padding:"7px 12px", background:view==="stack"?BG:"transparent", color:view==="stack"?INK:MUTED, border:"none", borderRadius:999, cursor:"pointer", display:"flex", alignItems:"center", boxShadow:view==="stack"?"0 1px 3px rgba(0,0,0,0.08)":"none" }} onClick={function() { setView("stack"); }}>
            <Layers size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
      {activeGenres.length > 0 && (
        <div className="chipScroll" style={{ display:"flex", gap:6, alignItems:"center", overflowX:"auto", padding:"0 clamp(16px, 4vw, 48px) 14px" }}>
          <button style={{ display:"flex", alignItems:"center", padding:"6px 12px", background:genreFilter===null?INK:"transparent", color:genreFilter===null?BG:MUTED, border:"1px solid "+(genreFilter===null?INK:RULE_SOFT), borderRadius:999, fontSize:12, cursor:"pointer", fontFamily:FONT_SANS, fontWeight:500, flexShrink:0 }} onClick={function() { setGenreFilter(null); }}>
            All genres
          </button>
          {activeGenres.map(function(g) {
            var active = genreFilter === g;
            return (
              <button key={g} style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 12px", background:active?INK:"transparent", color:active?BG:MUTED, border:"1px solid "+(active?INK:RULE_SOFT), borderRadius:999, fontSize:12, cursor:"pointer", fontFamily:FONT_SANS, fontWeight:500, flexShrink:0, whiteSpace:"nowrap" }} onClick={function() { setGenreFilter(active ? null : g); }}>
                <span>{g}</span><span style={{ fontFamily:FONT_MONO, fontSize:10, opacity:0.6 }}>{genreCounts[g]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Circle View ────────────────────────────────────────────────────────────
// Group by `addedBy` name. For each member, show their books as fanned cards.

function CircleView({ books, userMap, onSelect }) {
  // Group books by addedBy
  var groups = {};
  books.forEach(function(b) {
    var by = b.addedBy || "Unknown";
    if (!groups[by]) groups[by] = [];
    groups[by].push(b);
  });
  var members = Object.keys(groups).sort(function(a,b) {
    return groups[b].length - groups[a].length;
  });

  if (members.length === 0) {
    return (
      <div style={{ padding:"clamp(60px, 12vw, 120px) clamp(16px, 4vw, 48px)", textAlign:"center", position:"relative", zIndex:1 }}>
        <div style={{ fontFamily:FONT_DISPLAY, fontSize:32, fontStyle:"italic", color:MUTED }}>
          No one else has added books yet.
        </div>
      </div>
    );
  }

  return (
    <div style={{ position:"relative", zIndex:1, padding:"32px 0 100px", display:"flex", flexDirection:"column", gap:48 }}>
      {members.map(function(member, mi) {
        var memberBooks = groups[member];
        return (
          <section key={member} style={{ padding:"0 clamp(16px, 4vw, 48px)", animation:"laneIn 0.6s cubic-bezier(0.2,0.8,0.2,1) both", animationDelay:(mi*80)+"ms" }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:20, paddingBottom:10, borderBottom:"1px solid "+RULE_SOFT }}>
              <h3 style={{ fontFamily:FONT_DISPLAY, fontSize:22, fontWeight:500, margin:0, letterSpacing:"-0.02em" }}>{member}</h3>
              <span style={{ fontFamily:FONT_MONO, fontSize:10, color:MUTED, letterSpacing:"0.15em" }}>{String(memberBooks.length).padStart(2,"0")} {memberBooks.length===1?"book":"books"}</span>
            </div>
            <FannedHand books={memberBooks} onSelect={onSelect} />
          </section>
        );
      })}
    </div>
  );
}

function FannedHand({ books, onSelect }) {
  // Cards overlap each other. To avoid hover-zone collision between layered
  // cards, we track the mouse position against the visible strip of each card
  // rather than relying on per-card onMouseEnter.
  var hoverArr = useState(-1); var hovered = hoverArr[0]; var setHovered = hoverArr[1];

  var cardW = 120;
  var cardH = 180;
  var overlap = 42; // px of each card that\'s visible (the exposed strip on the left edge)
  var rowHeight = cardH + 60;
  var containerRef = useRef(null);

  function handleMove(e) {
    if (!containerRef.current) return;
    var rect = containerRef.current.getBoundingClientRect();
    var x = e.clientX - rect.left + containerRef.current.scrollLeft;
    var y = e.clientY - rect.top;
    // Only register hover if the pointer is over the card row vertically
    if (y < 0 || y > cardH + 20) { setHovered(-1); return; }
    // Which card strip is under the pointer?
    // First N-1 cards occupy strips of width `overlap`. The last card gets full width.
    var idx = Math.floor(x / overlap);
    if (idx >= books.length) idx = books.length - 1;
    if (idx < 0) idx = -1;
    setHovered(idx);
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMove}
      onMouseLeave={function() { setHovered(-1); }}
      style={{
        position:"relative",
        height: rowHeight,
        overflowX: "auto",
        overflowY: "visible",
        paddingTop: 20,
      }}
      className="chipScroll"
    >
      <div style={{
        position:"relative",
        height: cardH,
        width: Math.max(books.length * overlap + (cardW - overlap) + 40, 100),
      }}>
        {books.map(function(book, i) {
          var rot = ((i % 7) - 3) * 1.5;
          var isHover = hovered === i;
          var z = isHover ? 100 : i;
          var lift = isHover ? -20 : 0;
          // When hovered, nudge this card out of the pack so it\'s readable
          var shiftX = isHover ? 18 : 0;
          return (
            <div key={book.id}
              onClick={function() { onSelect(book); }}
              style={{
                position:"absolute",
                left: i * overlap + shiftX,
                top: 0,
                width: cardW,
                height: cardH,
                background: spineColorFor(book),
                borderRadius: 4,
                cursor: "pointer",
                overflow: "hidden",
                transform: "rotate(" + (isHover ? 0 : rot) + "deg) translateY(" + lift + "px) scale(" + (isHover ? 1.1 : 1) + ")",
                transformOrigin: "bottom center",
                transition: "transform 0.28s cubic-bezier(0.2,0.8,0.2,1), left 0.28s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.28s ease",
                boxShadow: isHover ? "0 24px 44px rgba(0,0,0,0.32)" : "0 4px 12px rgba(0,0,0,0.12)",
                zIndex: z,
                pointerEvents: "none", // hover handled on parent; parent handles clicks via child click bubble
              }}>
              <CoverImage book={book} showMetaOnFallback={true} />
            </div>
          );
        })}
        {/* Invisible click capture zones — one per card, sized to the visible strip */}
        {books.map(function(book, i) {
          var isLast = i === books.length - 1;
          return (
            <button key={"hit-" + book.id}
              onClick={function(e) { e.stopPropagation(); onSelect(book); }}
              aria-label={book.title}
              style={{
                position:"absolute",
                left: i * overlap,
                top: 0,
                width: isLast ? cardW : overlap,
                height: cardH,
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                zIndex: hovered === i ? 101 : 200,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Spine Grid ─────────────────────────────────────────────────────────────

function groupByGenre(books) {
  var groups = new Map();
  for (var i = 0; i < books.length; i++) {
    var g = genreForBook(books[i]) || "Other";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(books[i]);
  }
  return Array.from(groups.entries()).sort(function(a, b) {
    if (a[0] === "Other") return 1;
    if (b[0] === "Other") return -1;
    return b[1].length - a[1].length;
  });
}

function SpineGrid({ books, onSelect, onAdd }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:3, padding:"40px clamp(16px, 4vw, 48px) 80px", alignItems:"flex-end", position:"relative", zIndex:1 }}>
      {books.map(function(book, i) { return <Spine key={book.id} book={book} index={i} onSelect={onSelect} />; })}
      <AddSpine onClick={onAdd} index={books.length} />
    </div>
  );
}

var Spine = memo(function Spine({ book, index, onSelect }) {
  var color = spineColorFor(book);
  var width = spineWidthFor(book);
  var hasReviews = (book.reviews || []).length > 0;
  var stagger = Math.min(index * 6, 500);

  return (
    <button
      className="spine"
      style={{ width:width+"px", height:340, background:color, border:"none", padding:0, cursor:"pointer", display:"flex", flexDirection:"column", justifyContent:"space-between", overflow:"hidden", animation:"spineIn 0.6s cubic-bezier(0.2,0.8,0.2,1) both", animationDelay:stagger+"ms", fontFamily:FONT_SANS, position:"relative" }}
      onClick={function() { onSelect(book); }}
    >
      <div style={{ padding:"18px 12px 10px", minHeight:100 }}>
        <span style={{ fontFamily:FONT_SERIF, fontSize:15, fontWeight:500, lineHeight:1.15, color:"#fff", letterSpacing:"-0.015em", display:"-webkit-box", WebkitLineClamp:6, WebkitBoxOrient:"vertical", overflow:"hidden", textAlign:"left", wordBreak:"break-word" }}>{book.title}</span>
      </div>
      <div style={{ padding:"8px 12px 14px", display:"flex", flexDirection:"column", gap:4 }}>
        <span style={{ fontFamily:FONT_SANS, fontSize:10, fontWeight:500, color:"rgba(255,255,255,0.85)", letterSpacing:"0.02em", textTransform:"uppercase", overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>{book.author}</span>
        {book.year && <span style={{ fontFamily:FONT_MONO, fontSize:9, color:"rgba(255,255,255,0.55)", letterSpacing:"0.05em" }}>{book.year}</span>}
      </div>
      {hasReviews && <div style={{ position:"absolute", top:10, right:10, width:6, height:6, borderRadius:"50%", background:"rgba(255,255,255,0.9)" }} />}
    </button>
  );
});

function AddSpine({ onClick, index }) {
  return (
    <button className="add-spine" style={{ width:86, height:340, background:"transparent", border:"2px dashed "+RULE, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, color:MUTED, fontFamily:FONT_SANS, animation:"spineIn 0.6s cubic-bezier(0.2,0.8,0.2,1) both", animationDelay:(index*18)+"ms" }} onClick={onClick} aria-label="Add a book">
      <Plus size={20} strokeWidth={2} />
      <span style={{ fontSize:11, fontWeight:500 }}>Add</span>
    </button>
  );
}

// ── Stack View ─────────────────────────────────────────────────────────────

var STACK_TOASTS = [
  "Whoa, that pile's about to topple!",
  "Your TBR defies the laws of physics.",
  "Structural integrity: questionable.",
  "The stack trembles in reverence.",
  "Even libraries are jealous.",
  "One more and you'll need scaffolding.",
  "Sir Isaac Newton would like a word.",
  "The books are holding a meeting about this.",
  "Gravity is starting to look nervous.",
  "A moment of silence for your free time.",
];

function StackView({ books, onSelect, onAdd }) {
  var prevRef = useRef(books.length);
  var trembleArr = useState(false); var trembling = trembleArr[0]; var setTrembling = trembleArr[1];
  var toastArr = useState(null); var toast = toastArr[0]; var setToast = toastArr[1];

  useEffect(function() {
    if (books.length > prevRef.current) {
      setTrembling(true);
      var msg = STACK_TOASTS[hashString(String(books.length)) % STACK_TOASTS.length];
      setToast(msg);
      var t1 = setTimeout(function() { setTrembling(false); }, 700);
      var t2 = setTimeout(function() { setToast(null); }, 3200);
      prevRef.current = books.length;
      return function() { clearTimeout(t1); clearTimeout(t2); };
    }
    prevRef.current = books.length;
  }, [books.length]);

  return (
    <div style={{ position:"relative", zIndex:1 }}>
      {toast && (
        <div style={{ position:"fixed", bottom:32, left:"50%", transform:"translateX(-50%)", zIndex:500, background:INK, color:BG, fontFamily:FONT_SERIF, fontStyle:"italic", fontSize:15, padding:"12px 22px", borderRadius:999, boxShadow:"0 8px 28px rgba(0,0,0,0.22)", whiteSpace:"nowrap", animation:"toastIn 0.35s cubic-bezier(0.2,0.8,0.2,1)", pointerEvents:"none" }}>
          {toast}
        </div>
      )}
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"60px clamp(16px, 4vw, 48px) 100px", gap:3, overflowX:"hidden", animation:trembling?"stackTremble 0.65s ease":"none" }}>
        {books.map(function(book, i) {
          var h = hashString(book.id || book.title);
          var rot = ((h % 11) - 5) * 0.7;
          var xOff = ((hashString((book.id||"")+"x") % 80) - 40);
          var bookH = 54 + (h % 28);
          var stagger = Math.min(i * 40, 1200);
          return <StackBook key={book.id} book={book} rot={rot} xOff={xOff} bookH={bookH} stagger={stagger} onSelect={onSelect} />;
        })}
        <button
          style={{ marginTop:16, display:"flex", alignItems:"center", gap:8, padding:"12px 24px", background:"transparent", border:"2px dashed "+RULE, borderRadius:999, fontSize:13, color:MUTED, cursor:"pointer", fontFamily:FONT_SANS, fontWeight:500 }}
          onMouseEnter={function(e) { e.currentTarget.style.borderColor=INK; e.currentTarget.style.color=INK; }}
          onMouseLeave={function(e) { e.currentTarget.style.borderColor=RULE; e.currentTarget.style.color=MUTED; }}
          onClick={onAdd}
        >
          <Plus size={14} strokeWidth={2.5} /> Add to the pile
        </button>
      </div>
    </div>
  );
}

function StackBook({ book, rot, xOff, bookH, stagger, onSelect }) {
  var color = spineColorFor(book);
  var hArr = useState(false); var hovered = hArr[0]; var setHovered = hArr[1];

  var baseTransform = "rotate("+rot+"deg) translateX("+xOff+"px) translateY(0px)";
  var hoverTransform = "rotate("+(rot*0.3)+"deg) translateX("+(xOff*0.5)+"px) translateY(-8px)";

  return (
    <button
      onClick={function() { onSelect(book); }}
      onMouseEnter={function() { setHovered(true); }}
      onMouseLeave={function() { setHovered(false); }}
      style={{
        display:"flex", alignItems:"center",
        width:"min(900px, 90vw)", height:bookH,
        background:color, border:"none", cursor:"pointer",
        position:"relative", borderRadius:2, padding:"0 24px", gap:20, flexShrink:0,
        transform: hovered ? hoverTransform : baseTransform,
        transition:"transform 0.25s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.25s ease",
        boxShadow:hovered ? "0 16px 40px rgba(0,0,0,0.22)" : "0 3px 10px rgba(0,0,0,0.1)",
        animation:"stackSlideIn 0.7s cubic-bezier(0.2,0.8,0.2,1) "+stagger+"ms both",
        zIndex:hovered?10:1,
      }}
    >
      <div style={{ width:4, height:"60%", background:"rgba(255,255,255,0.35)", borderRadius:2, flexShrink:0 }} />
      <div style={{ flex:1, minWidth:0, textAlign:"left" }}>
        <div style={{ fontFamily:FONT_SERIF, fontSize:Math.max(11,bookH*0.28), fontWeight:600, color:"#fff", letterSpacing:"-0.015em", lineHeight:1.1, overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>{book.title}</div>
        <div style={{ fontFamily:FONT_MONO, fontSize:Math.max(9,bookH*0.17), color:"rgba(255,255,255,0.75)", letterSpacing:"0.04em", textTransform:"uppercase", marginTop:3, overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>{book.author}{book.year ? " \u00b7 " + book.year : ""}</div>
      </div>
      {genreForBook(book) && bookH > 60 && (
        <div style={{ fontFamily:FONT_MONO, fontSize:9, color:"rgba(255,255,255,0.6)", letterSpacing:"0.12em", textTransform:"uppercase", flexShrink:0 }}>{genreForBook(book)}</div>
      )}
    </button>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────

function EmptyState({ onAdd, filter }) {
  var msgs = { all:"The library is empty.", mine:"You haven't shelved anything yet.", reading:"Nobody is currently reading.", read:"No finished books yet.", want:"The wishlist is empty." };
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:24, padding:"clamp(60px, 12vw, 120px) clamp(16px, 4vw, 48px)", textAlign:"center", position:"relative", zIndex:1 }}>
      <div style={{ fontFamily:FONT_DISPLAY, fontSize:42, fontStyle:"italic", fontWeight:400, letterSpacing:"-0.025em" }}>{msgs[filter] || msgs.all}</div>
      <button style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 18px", background:INK, color:BG, border:"none", borderRadius:999, fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:FONT_SANS }} onClick={onAdd}>
        <Plus size={14} strokeWidth={2.5} /> Add a book
      </button>
    </div>
  );
}

// ── Search Overlay ─────────────────────────────────────────────────────────

var SEARCH_MSGS = [
  "Consulting the catalogue...", "Rifling through the stacks...", "Checking the card index...",
  "Dusting off the shelves...", "Following a citation trail...", "Asking the librarian...",
  "Cross-referencing the index...", "Tracking down a first edition...",
  "Every book is a door...", "A reader lives a thousand lives...",
  "The library is a mirror of the mind...", "In search of the right spine...",
];

function SearchLoadingMessages() {
  var idxArr = useState(function() { return Math.floor(Math.random() * SEARCH_MSGS.length); });
  var msgIndex = idxArr[0]; var setMsgIndex = idxArr[1];
  var visArr = useState(true); var visible = visArr[0]; var setVisible = visArr[1];
  useEffect(function() {
    var id = setInterval(function() {
      setVisible(false);
      setTimeout(function() {
        setMsgIndex(function(i) { return (i+1) % SEARCH_MSGS.length; });
        setVisible(true);
      }, 400);
    }, 2800);
    return function() { clearInterval(id); };
  }, []);
  return (
    <div style={{ padding:"40px 0 20px", textAlign:"center" }}>
      <div style={{ fontFamily:FONT_SERIF, fontSize:18, fontStyle:"italic", color:MUTED, opacity:visible?1:0, transform:visible?"translateY(0)":"translateY(6px)", transition:"opacity 0.4s ease, transform 0.4s ease" }}>
        {SEARCH_MSGS[msgIndex]}
      </div>
      <div style={{ display:"flex", justifyContent:"center", gap:5, marginTop:16 }}>
        {[0,1,2].map(function(i) {
          return <div key={i} style={{ width:5, height:5, borderRadius:"50%", background:MUTED, opacity:0.5, animation:"dotBounce 1.2s ease-in-out "+(i*0.2)+"s infinite" }} />;
        })}
      </div>
    </div>
  );
}

function SearchOverlay({ onClose, onAdd, existingIds }) {
  var qArr = useState(""); var query = qArr[0]; var setQuery = qArr[1];
  var resArr = useState([]); var results = resArr[0]; var setResults = resArr[1];
  var searchingArr = useState(false); var searching = searchingArr[0]; var setSearching = searchingArr[1];
  var errArr = useState(null); var error = errArr[0]; var setError = errArr[1];
  var selArr = useState(null); var selectedResult = selArr[0]; var setSelectedResult = selArr[1];
  var inputRef = useRef(null);

  useEffect(function() { inputRef.current && inputRef.current.focus(); }, []);
  useEffect(function() {
    if (!query.trim()) { setResults([]); setError(null); return; }
    var timer = setTimeout(async function() {
      setSearching(true); setError(null);
      try { setResults(await searchBooks(query)); }
      catch(e) { setError(e.message || "Error"); setResults([]); }
      finally { setSearching(false); }
    }, 700);
    return function() { clearTimeout(timer); };
  }, [query]);

  return (
    <div style={{ position:"fixed", inset:0, zIndex:200, background:BG, display:"flex", flexDirection:"column", animation:"overlayIn 0.35s ease" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"28px 48px 0" }}>
        <div style={{ fontFamily:FONT_MONO, fontSize:11, color:MUTED, letterSpacing:"0.2em" }}>FIND</div>
        <button style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 18px", background:"transparent", border:"1px solid "+RULE_SOFT, borderRadius:999, fontSize:13, fontFamily:FONT_SANS, color:INK, cursor:"pointer" }} onClick={onClose}>Close <X size={16} strokeWidth={2} /></button>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:20, padding:"60px 48px 20px" }}>
        <Search size={32} strokeWidth={1.5} style={{ color:"#999", flexShrink:0 }} />
        <input style={{ flex:1, border:"none", background:"transparent", fontSize:"clamp(40px,6vw,80px)", fontFamily:FONT_DISPLAY, fontWeight:400, fontStyle:"italic", outline:"none", color:INK, letterSpacing:"-0.035em", padding:0, lineHeight:1.0 }} placeholder="title, author, ISBN..." value={query} onChange={function(e) { setQuery(e.target.value); }} ref={inputRef} />
        {searching && <Loader2 size={22} className="spin" style={{ color:"#999" }} />}
      </div>
      <div style={{ height:1, background:RULE, margin:"0 48px" }} />
      <div style={{ flex:1, overflowY:"auto", padding:"24px 48px 48px" }}>
        {!query && !searching && (
          <div style={{ padding:"24px 0" }}>
            <div style={{ fontFamily:FONT_MONO, fontSize:11, color:MUTED, letterSpacing:"0.15em", marginBottom:16 }}>Try:</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {["Tolstoy","Octavia Butler","Dune","Calvino","James Baldwin","Piranesi"].map(function(s) {
                return <button key={s} className="searchPrompt" style={{ padding:"8px 16px", background:"transparent", border:"1px solid "+RULE_SOFT, borderRadius:999, fontFamily:FONT_SERIF, fontSize:15, fontStyle:"italic", color:INK, cursor:"pointer" }} onClick={function() { setQuery(s); }}>{s}</button>;
              })}
            </div>
          </div>
        )}
        {searching && <SearchLoadingMessages />}
        {error && <div style={{ padding:"32px 0", color:"#E63946", fontFamily:FONT_SERIF, fontStyle:"italic" }}>Could not reach the catalogue</div>}
        {!searching && !error && query && results.length === 0 && <div style={{ padding:"32px 0", color:MUTED, fontFamily:FONT_SERIF, fontStyle:"italic" }}>Nothing found for "{query}"</div>}
        <div style={{ display:"flex", flexDirection:"column" }}>
          {results.map(function(r, i) {
            var isAdded = existingIds.has(r.id);
            var isSel = selectedResult && selectedResult.id === r.id;
            return (
              <div key={r.id} style={{ borderTop:"1px solid "+RULE, animation:"resultIn 0.4s ease both", animationDelay:(i*35)+"ms" }}>
                <div style={{ display:"flex", alignItems:"center", gap:20, padding:"20px 0", cursor:isAdded?"default":"pointer" }} onClick={function() { if (!isAdded) setSelectedResult(isSel ? null : r); }}>
                  <div style={{ width:56, height:82, background:"#e8e4dc", overflow:"hidden", flexShrink:0 }}>
                    <CoverImage book={r} showMetaOnFallback={false} />
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:FONT_SERIF, fontSize:24, fontWeight:500, color:INK, letterSpacing:"-0.02em", lineHeight:1.15, marginBottom:4 }}>{r.title}</div>
                    <div style={{ fontFamily:FONT_SERIF, fontSize:16, fontStyle:"italic", color:MUTED }}>{r.author}</div>
                    {r.year && <div style={{ fontFamily:FONT_MONO, fontSize:10, color:MUTED, marginTop:2 }}>{r.year}</div>}
                  </div>
                  {isAdded ? (
                    <div style={{ fontFamily:FONT_MONO, fontSize:10, padding:"4px 10px", background:"rgba(14,14,14,0.05)", color:MUTED, borderRadius:999, textTransform:"uppercase" }}>On shelf</div>
                  ) : (
                    <div style={{ fontFamily:FONT_SERIF, fontStyle:"italic", fontSize:18, color:INK }}>{isSel ? "Cancel" : "Add \u2192"}</div>
                  )}
                </div>
                {isSel && !isAdded && <ResultPicker result={r} onAdd={onAdd} />}
              </div>
            );
          })}
        </div>
      </div>
      <style>{GLOBAL_CSS}</style>
    </div>
  );
}

function ResultPicker({ result, onAdd }) {
  var rArr = useState(0); var rating = rArr[0]; var setRating = rArr[1];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12, padding:"4px 0 24px 76px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
        <div style={{ fontFamily:FONT_MONO, fontSize:10, color:MUTED, letterSpacing:"0.15em", minWidth:56, textTransform:"uppercase" }}>Rate it</div>
        <StarRating value={rating} onChange={setRating} size={22} />
        <div style={{ fontFamily:FONT_SERIF, fontSize:12, fontStyle:"italic", color:MUTED }}>optional</div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
        <div style={{ fontFamily:FONT_MONO, fontSize:10, color:MUTED, letterSpacing:"0.15em", minWidth:56, textTransform:"uppercase" }}>Status</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {Object.entries(STATUSES).map(function(entry) {
            var key = entry[0]; var s = entry[1]; var Icon = s.icon;
            return (
              <button key={key} style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 16px", background:INK, color:BG, border:"none", borderRadius:999, fontSize:12, cursor:"pointer", fontFamily:FONT_SANS }} onClick={function() { onAdd(result, key, rating); }}>
                <Icon size={14} strokeWidth={2} /> {s.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Goodreads Import ───────────────────────────────────────────────────────

function mapShelf(shelf) {
  if (!shelf) return null;
  var s = shelf.toLowerCase();
  if (s === "read") return "read";
  if (s === "currently-reading") return "reading";
  return "want";
}

function cleanIsbn(raw) {
  if (!raw) return null;
  var c = String(raw).replace(/^="?|"?$/g, "").trim();
  return (c && c !== "0") ? c : null;
}

function parseGoodreadsCsv(file) {
  return new Promise(function(resolve, reject) {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: function(result) {
        var books = result.data.map(function(row) {
          var title = (row["Title"] || "").trim();
          var author = (row["Author"] || "").trim();
          if (!title) return null;
          var isbn = cleanIsbn(row["ISBN13"]) || cleanIsbn(row["ISBN"]);
          var rating = parseInt(row["My Rating"], 10) || 0;
          var year = parseInt(row["Original Publication Year"], 10) || parseInt(row["Year Published"], 10) || null;
          var status = mapShelf(row["Exclusive Shelf"]);
          var id = isbn ? ("gr:isbn:" + isbn) : ("gr:" + hashString(title.toLowerCase() + "|" + author.toLowerCase()));
          return { id:id, title:title, author:author, year:year, isbn:isbn, status:status, rating:rating };
        }).filter(Boolean);
        resolve(books);
      },
      error: reject,
    });
  });
}

function ImportModal({ onClose, onImport }) {
  var stageArr = useState("idle"); var stage = stageArr[0]; var setStage = stageArr[1];
  var parsedArr = useState([]); var parsed = parsedArr[0]; var setParsed = parsedArr[1];
  var resultArr = useState(null); var result = resultArr[0]; var setResult = resultArr[1];
  var errArr = useState(null); var error = errArr[0]; var setError = errArr[1];
  var dragArr = useState(false); var dragging = dragArr[0]; var setDragging = dragArr[1];
  var fileRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { setError("Please upload a .csv file exported from Goodreads."); setStage("error"); return; }
    setError(null); setStage("parsing");
    try {
      var books = await parseGoodreadsCsv(file);
      if (!books.length) { setError("No books found in this file."); setStage("error"); return; }
      setParsed(books); setStage("preview");
    } catch(e) { setError(e.message || "Parse error"); setStage("error"); }
  }

  var counts = parsed.reduce(function(acc, b) {
    if (b.status==="read") acc.read++; else if (b.status==="reading") acc.reading++; else acc.want++;
    if (b.rating>0) acc.rated++;
    return acc;
  }, { read:0, reading:0, want:0, rated:0 });

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(14,14,14,0.35)", backdropFilter:"blur(8px)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:100, animation:"fadeIn 0.25s ease" }} onClick={onClose}>
      <div style={{ width:"100%", maxWidth:560, maxHeight:"88vh", background:BG, borderRadius:"4px 4px 0 0", display:"flex", flexDirection:"column", animation:"sheetIn 0.4s ease", boxShadow:"0 -20px 60px rgba(0,0,0,0.2)" }} onClick={function(e) { e.stopPropagation(); }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"28px 32px 16px", borderBottom:"1px solid "+RULE }}>
          <div>
            <div style={{ fontFamily:FONT_MONO, fontSize:11, color:MUTED, letterSpacing:"0.2em" }}>IMPORT</div>
            <h2 style={{ fontFamily:FONT_DISPLAY, fontSize:36, fontWeight:400, margin:"8px 0 0", letterSpacing:"-0.03em" }}>From Goodreads</h2>
          </div>
          <button style={{ display:"flex", alignItems:"center", gap:6, padding:"0 14px", height:36, borderRadius:999, border:"1px solid "+RULE_SOFT, background:BG, cursor:"pointer", fontFamily:FONT_SANS, fontSize:12 }} onClick={onClose}><X size={18} strokeWidth={2} /></button>
        </div>
        <div style={{ padding:"28px 32px 32px", overflowY:"auto", flex:1 }}>
          {stage === "idle" && (
            <React.Fragment>
              <p style={{ fontFamily:FONT_SERIF, fontSize:16, lineHeight:1.5, margin:"0 0 24px" }}>Export your library from <em>goodreads.com/review/import</em> and drop the CSV here.</p>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"40px 24px", border:"2px dashed "+(dragging?INK:RULE), borderRadius:4, cursor:"pointer", marginBottom:24, background:dragging?"rgba(14,14,14,0.03)":"transparent" }}
                onClick={function() { fileRef.current && fileRef.current.click(); }}
                onDragOver={function(e) { e.preventDefault(); setDragging(true); }}
                onDragLeave={function() { setDragging(false); }}
                onDrop={function(e) { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}
              >
                <Upload size={28} strokeWidth={1.5} style={{ color:MUTED, marginBottom:12 }} />
                <div style={{ fontFamily:FONT_SERIF, fontSize:18, fontWeight:500, marginBottom:4 }}>Drop your CSV here</div>
                <div style={{ fontSize:12, color:MUTED, fontFamily:FONT_SANS }}>or click to browse</div>
                <input ref={fileRef} type="file" accept=".csv" style={{ display:"none" }} onChange={function(e) { handleFile(e.target.files && e.target.files[0]); }} />
              </div>
            </React.Fragment>
          )}
          {(stage==="parsing"||stage==="importing") && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16, padding:"48px 20px" }}>
              <Loader2 size={28} className="spin" style={{ color:MUTED }} />
              <div style={{ fontFamily:FONT_SERIF, fontStyle:"italic", fontSize:15, color:MUTED }}>{stage==="parsing"?"Reading your library...":"Shelving the books..."}</div>
            </div>
          )}
          {stage === "preview" && (
            <React.Fragment>
              <div style={{ textAlign:"center", padding:"24px 0 16px" }}>
                <div style={{ fontFamily:FONT_DISPLAY, fontSize:72, fontWeight:400, letterSpacing:"-0.04em", lineHeight:1 }}>{parsed.length}</div>
                <div style={{ fontFamily:FONT_MONO, fontSize:11, color:MUTED, letterSpacing:"0.15em", marginTop:8, textTransform:"uppercase" }}>books found</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8, padding:"16px 0", borderTop:"1px solid "+RULE_SOFT, borderBottom:"1px solid "+RULE_SOFT, marginBottom:16 }}>
                {counts.read>0 && <div style={{ display:"flex", alignItems:"center", gap:10, fontFamily:FONT_SERIF, fontSize:15 }}><Check size={14} strokeWidth={2} /> {counts.read} finished</div>}
                {counts.reading>0 && <div style={{ display:"flex", alignItems:"center", gap:10, fontFamily:FONT_SERIF, fontSize:15 }}><BookOpen size={14} strokeWidth={2} /> {counts.reading} currently reading</div>}
                {counts.want>0 && <div style={{ display:"flex", alignItems:"center", gap:10, fontFamily:FONT_SERIF, fontSize:15 }}><Bookmark size={14} strokeWidth={2} /> {counts.want} on the wishlist</div>}
              </div>
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                <button style={{ padding:"10px 18px", background:"transparent", color:INK, border:"1px solid "+RULE_SOFT, borderRadius:999, fontSize:13, cursor:"pointer", fontFamily:FONT_SANS }} onClick={onClose}>Cancel</button>
                <button style={{ padding:"10px 20px", background:INK, color:BG, border:"none", borderRadius:999, fontSize:13, cursor:"pointer", fontFamily:FONT_SANS }} onClick={async function() { setStage("importing"); try { setResult(await onImport(parsed)); setStage("done"); } catch(e) { setError(e.message||"Error"); setStage("error"); } }}>Import {parsed.length} books &rarr;</button>
              </div>
            </React.Fragment>
          )}
          {stage==="done" && result && (
            <React.Fragment>
              <div style={{ textAlign:"center", padding:"24px 0 16px" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", marginBottom:8 }}><Check size={32} strokeWidth={2} style={{ color:"#06A77D" }} /></div>
                <div style={{ fontFamily:FONT_MONO, fontSize:11, color:MUTED, letterSpacing:"0.15em", textTransform:"uppercase" }}>{result.added} added{result.merged>0?" \u00b7 "+result.merged+" merged":""}</div>
              </div>
              <div style={{ display:"flex", justifyContent:"flex-end" }}>
                <button style={{ padding:"10px 20px", background:INK, color:BG, border:"none", borderRadius:999, fontSize:13, cursor:"pointer", fontFamily:FONT_SANS }} onClick={onClose}>Done</button>
              </div>
            </React.Fragment>
          )}
          {stage==="error" && (
            <React.Fragment>
              <div style={{ fontFamily:FONT_SERIF, fontStyle:"italic", fontSize:15, color:"#C62828", textAlign:"center", padding:"32px 0" }}>{error}</div>
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                <button style={{ padding:"10px 18px", background:"transparent", border:"1px solid "+RULE_SOFT, borderRadius:999, fontSize:13, cursor:"pointer", fontFamily:FONT_SANS }} onClick={function() { setStage("idle"); }}>Try again</button>
                <button style={{ padding:"10px 20px", background:INK, color:BG, border:"none", borderRadius:999, fontSize:13, cursor:"pointer", fontFamily:FONT_SANS }} onClick={onClose}>Close</button>
              </div>
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Recommendations ────────────────────────────────────────────────────────

function computeRecs(books, currentUser, currentUserId, userMap, favGenres, limit) {
  limit = limit || 3;
  favGenres = favGenres || [];
  userMap = userMap || {};

  // isMine: a book is "mine" if either the UUID key or the legacy name key is set
  function isMine(b) {
    if (!b.readers) return false;
    if (currentUserId && b.readers[currentUserId]) return true;
    if (currentUser && b.readers[currentUser]) return true;
    return false;
  }
  function myRating(b) {
    if (!b.ratings) return 0;
    if (currentUserId && b.ratings[currentUserId]) return b.ratings[currentUserId];
    if (currentUser && b.ratings[currentUser]) return b.ratings[currentUser];
    return 0;
  }
  function myStatus(b) {
    if (!b.readers) return null;
    if (currentUserId && b.readers[currentUserId]) return b.readers[currentUserId];
    if (currentUser && b.readers[currentUser]) return b.readers[currentUser];
    return null;
  }
  function displayFor(key) { return (userMap && userMap[key]) || key; }

  var myBooks = books.filter(isMine);
  var myRead  = books.filter(function(b) { return myStatus(b) === "read"; });
  var shelvedIds = new Set(myBooks.map(function(b) { return b.id; }));
  var candidates = books.filter(function(b) { return !shelvedIds.has(b.id); });

  // Build taste-twin affinity from user's own ratings
  var genreSum = {}, genreCount = {};
  myRead.forEach(function(b) {
    var g = genreForBook(b), r = myRating(b);
    if (g && r > 0) { genreSum[g] = (genreSum[g]||0)+r; genreCount[g] = (genreCount[g]||0)+1; }
  });
  var genreAffinity = {};
  Object.keys(genreSum).forEach(function(g) { genreAffinity[g] = genreSum[g] / genreCount[g]; });

  return candidates.map(function(b) {
    var allRaters = Object.keys(b.ratings || {});
    // Exclude the current user (by either key)
    var raters = allRaters.filter(function(r) {
      return r !== currentUserId && r !== currentUser;
    });
    var wSum = 0, wRating = 0;
    raters.forEach(function(r) { wSum += 1; wRating += b.ratings[r]; });
    var avg = wSum > 0 ? wRating / wSum : 0;
    if (avg > 0 && avg < 3.5) return null;
    var genre = genreForBook(b);
    var isFav = genre && favGenres.indexOf(genre) !== -1;

    var favBoost = isFav ? 1.5 : 0;
    var affinityBoost = genre && genreAffinity[genre] ? (genreAffinity[genre]-3)*0.4 : 0;
    var score = (avg > 0 ? avg : 3.5) + favBoost + affinityBoost;

    var topRater = raters.filter(function(r) { return b.ratings[r] >= 4; })[0];
    var reason;
    if (isFav) {
      reason = "One of your favorites \u2014 " + genre.toLowerCase();
    } else if (topRater) {
      reason = displayFor(topRater) + " rated this " + b.ratings[topRater] + "\u2605";
    } else if (genre) {
      reason = "A " + genre.toLowerCase() + " pick";
    } else {
      reason = "On the circle's shelf";
    }
    return { book:b, score:score, reason:reason, isFav:isFav };
  }).filter(Boolean).sort(function(a,b) { return b.score-a.score; }).slice(0, limit);
}

function RecsModal({ books, currentUser, currentUserId, userMap, favGenres, onClose, onSelect }) {
  var recs = computeRecs(books, currentUser, currentUserId, userMap, favGenres);
  var myRatings = books.filter(function(b) {
    var r = b.ratings || {};
    return (currentUserId && r[currentUserId] > 0) || (currentUser && r[currentUser] > 0);
  }).length;
  var context = myRatings === 0 ? "Rate a few books and these will get smarter." : "Based on your taste and your circle's ratings.";
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(14,14,14,0.35)", backdropFilter:"blur(8px)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:100, animation:"fadeIn 0.25s ease" }} onClick={onClose}>
      <div style={{ width:"100%", maxWidth:640, maxHeight:"92vh", background:BG, borderRadius:"4px 4px 0 0", display:"flex", flexDirection:"column", animation:"sheetIn 0.4s ease", boxShadow:"0 -20px 60px rgba(0,0,0,0.2)", overflow:"hidden" }} onClick={function(e) { e.stopPropagation(); }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"32px 32px 20px", borderBottom:"1px solid "+RULE }}>
          <div>
            <div style={{ fontFamily:FONT_MONO, fontSize:11, color:MUTED, letterSpacing:"0.2em" }}>FOR YOU</div>
            <h2 style={{ fontFamily:FONT_DISPLAY, fontSize:42, fontWeight:400, margin:"8px 0 12px", letterSpacing:"-0.035em", lineHeight:0.95 }}>Three books<br /><em>you might love</em></h2>
            <p style={{ fontFamily:FONT_SERIF, fontStyle:"italic", fontSize:14, color:MUTED, margin:0 }}>{context}</p>
          </div>
          <button style={{ display:"flex", alignItems:"center", padding:"0 14px", height:36, borderRadius:999, border:"1px solid "+RULE_SOFT, background:BG, cursor:"pointer" }} onClick={onClose}><X size={18} strokeWidth={2} /></button>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"24px 32px 32px", display:"flex", flexDirection:"column", gap:16 }}>
          {recs.length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px 20px" }}>
              <Sparkles size={36} strokeWidth={1.2} style={{ color:MUTED, marginBottom:16 }} />
              <div style={{ fontFamily:FONT_DISPLAY, fontSize:24, fontStyle:"italic", marginBottom:10 }}>Not enough signal yet.</div>
              <div style={{ fontFamily:FONT_SERIF, fontSize:14, color:MUTED, lineHeight:1.5 }}>Rate books you've finished to improve recommendations.</div>
            </div>
          ) : recs.map(function(rec, i) {
            return (
              <button key={rec.book.id} className="recCard" style={{ display:"flex", alignItems:"stretch", gap:20, padding:16, background:"rgba(244,234,213,0.5)", border:"1px solid "+RULE_SOFT, borderRadius:3, cursor:"pointer", textAlign:"left", fontFamily:FONT_SANS, animation:"resultIn 0.5s ease both", animationDelay:(i*80)+"ms" }} onClick={function() { onSelect(rec.book); }}>
                <div style={{ fontFamily:FONT_MONO, fontSize:11, color:"#E63946", letterSpacing:"0.1em", alignSelf:"flex-start", opacity:0.7 }}>{String(i+1).padStart(2,"0")}</div>
                <div style={{ width:80, height:118, background:"#e8e4dc", overflow:"hidden", flexShrink:0 }}>
                  <CoverImage book={rec.book} showMetaOnFallback={false} />
                </div>
                <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column" }}>
                  {genreForBook(rec.book) && <div style={{ fontFamily:FONT_MONO, fontSize:9, color:"#E63946", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:6 }}>{genreForBook(rec.book)}</div>}
                  <div style={{ fontFamily:FONT_SERIF, fontSize:20, fontWeight:500, letterSpacing:"-0.02em", lineHeight:1.15, marginBottom:4 }}>{rec.book.title}</div>
                  <div style={{ fontFamily:FONT_SERIF, fontSize:14, fontStyle:"italic", color:MUTED, marginBottom:"auto" }}>{rec.book.author}</div>
                  <div style={{ fontFamily:FONT_SERIF, fontSize:13, fontStyle:"italic", marginTop:12, paddingTop:12, borderTop:"1px dashed "+RULE_SOFT }}>{rec.reason}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Name Edit ──────────────────────────────────────────────────────────────

function NameEditModal({ currentName, onClose, onSave }) {
  var valArr = useState(currentName); var value = valArr[0]; var setValue = valArr[1];
  var ref = useRef(null);
  useEffect(function() { if (ref.current) { ref.current.focus(); ref.current.select(); } }, []);
  var changed = value.trim() && value.trim() !== currentName;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(14,14,14,0.35)", backdropFilter:"blur(8px)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:100, animation:"fadeIn 0.25s ease" }} onClick={onClose}>
      <div style={{ width:"100%", maxWidth:440, background:BG, borderRadius:"4px 4px 0 0", padding:32, animation:"sheetIn 0.4s ease", boxShadow:"0 -20px 60px rgba(0,0,0,0.2)" }} onClick={function(e) { e.stopPropagation(); }}>
        <div style={{ fontFamily:FONT_MONO, fontSize:11, color:MUTED, letterSpacing:"0.2em" }}>CHANGE NAME</div>
        <h2 style={{ fontFamily:FONT_DISPLAY, fontSize:36, fontWeight:400, margin:"8px 0 8px", letterSpacing:"-0.03em" }}>Who are you?</h2>
        <p style={{ fontFamily:FONT_SERIF, fontStyle:"italic", fontSize:14, color:MUTED, margin:"0 0 20px" }}>All your ratings, reviews, and shelves will follow.</p>
        <input ref={ref} style={{ width:"100%", padding:"14px 18px", fontSize:18, fontFamily:FONT_SERIF, border:"1px solid "+RULE_SOFT, borderRadius:999, background:"transparent", color:INK, outline:"none", marginBottom:20, boxSizing:"border-box" }} value={value} onChange={function(e) { setValue(e.target.value); }} onKeyDown={function(e) { if (e.key==="Enter" && changed) onSave(value); }} />
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button style={{ padding:"10px 18px", background:"transparent", border:"1px solid "+RULE_SOFT, borderRadius:999, fontSize:13, cursor:"pointer", fontFamily:FONT_SANS }} onClick={onClose}>Cancel</button>
          <button style={{ padding:"10px 20px", background:INK, color:BG, border:"none", borderRadius:999, fontSize:13, cursor:"pointer", fontFamily:FONT_SANS, opacity:changed?1:0.4 }} onClick={function() { if (changed) onSave(value); }} disabled={!changed}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Book Detail ────────────────────────────────────────────────────────────

function GenreEditor({ currentGenre, onChange }) {
  var editArr = useState(false); var editing = editArr[0]; var setEditing = editArr[1];
  if (editing) {
    return (
      <select style={{ marginTop:14, padding:"5px 14px", background:BG, color:INK, border:"1px solid "+RULE, borderRadius:999, fontSize:11, fontFamily:FONT_MONO, fontWeight:500, letterSpacing:"0.08em", textTransform:"uppercase", cursor:"pointer", outline:"none" }}
        value={currentGenre || ""} autoFocus
        onChange={function(e) { onChange(e.target.value || null); setEditing(false); }}
        onBlur={function() { setEditing(false); }}
      >
        <option value="">-- no genre --</option>
        {GENRES.map(function(g) { return <option key={g} value={g}>{g}</option>; })}
      </select>
    );
  }
  return (
    <button style={{ display:"inline-flex", alignItems:"center", marginTop:14, padding:"5px 14px", background:"rgba(230,57,70,0.08)", color:"#E63946", border:"1px solid rgba(230,57,70,0.25)", borderRadius:999, fontSize:11, fontFamily:FONT_MONO, fontWeight:500, letterSpacing:"0.08em", textTransform:"uppercase", cursor:"pointer" }} onClick={function() { setEditing(true); }}>
      {currentGenre || "+ Add genre"}
    </button>
  );
}

function BookDetail({ book, currentUser, currentUserId, userMap, onClose, onUpdate, onRemove }) {
  function displayNameFor(key) {
    // key can be a UUID or a name string (legacy). userMap maps UUID -> name.
    if (userMap && userMap[key]) return userMap[key];
    return key;
  }
  var reviewArr = useState(""); var reviewText = reviewArr[0]; var setReviewText = reviewArr[1];
  var shareArr = useState(null); var shareStatus = shareArr[0]; var setShareStatus = shareArr[1];
  var myStatus = book.readers && book.readers[currentUser];
  var myRating = (book.ratings && book.ratings[currentUser]) || 0;
  var ratingEntries = Object.entries(book.ratings || {});
  var avgRating = ratingEntries.length > 0 ? ratingEntries.reduce(function(s, e) { return s + e[1]; }, 0) / ratingEntries.length : 0;
  var readerList = Object.entries(book.readers || {});
  var spineColor = spineColorFor(book);

  function shareBook() {
    var url = window.location.origin + window.location.pathname + "#book/" + encodeURIComponent(book.id);
    try { navigator.clipboard.writeText(url); setShareStatus("copied"); setTimeout(function() { setShareStatus(null); }, 2200); }
    catch(e) { window.prompt("Copy this link:", url); }
  }

  async function postReview() {
    if (!reviewText.trim()) return;
    var rv = { id:"r_"+Date.now(), author:currentUser, text:reviewText.trim(), at:Date.now() };
    await onUpdate(book.id, function(b) { return Object.assign({}, b, { reviews: (b.reviews||[]).concat([rv]) }); });
    setReviewText("");
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(14,14,14,0.35)", backdropFilter:"blur(8px)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:100, animation:"fadeIn 0.25s ease" }} onClick={onClose}>
      <div style={{ width:"100%", maxWidth:960, maxHeight:"92vh", background:BG, borderRadius:"4px 4px 0 0", position:"relative", overflow:"hidden", display:"flex", flexDirection:"column", animation:"sheetIn 0.4s ease", boxShadow:"0 -20px 60px rgba(0,0,0,0.2)" }} onClick={function(e) { e.stopPropagation(); }}>
        <div style={{ position:"absolute", top:20, right:20, zIndex:2, display:"flex", gap:8 }}>
          <button className="detailIconBtn" style={{ display:"flex", alignItems:"center", gap:6, height:36, padding:"0 14px", borderRadius:999, border:"1px solid "+RULE_SOFT, background:BG, cursor:"pointer", fontFamily:FONT_SANS, fontSize:12 }} onClick={shareBook}>
            {shareStatus==="copied" ? <Check size={16} strokeWidth={2.2} /> : <Link2 size={16} strokeWidth={2} />}
            {shareStatus==="copied" ? "Copied" : "Share"}
          </button>
          <button className="detailIconBtn" style={{ display:"flex", alignItems:"center", gap:6, height:36, padding:"0 14px", borderRadius:999, border:"1px solid "+RULE_SOFT, background:BG, cursor:"pointer", fontFamily:FONT_SANS, fontSize:12 }} onClick={onClose}><X size={18} strokeWidth={2} /></button>
        </div>
        <div style={{ height:6, background:spineColor, flexShrink:0 }} />
        <div style={{ display:"grid", gridTemplateColumns:"280px 1fr", gap:48, padding:"40px 48px 48px", overflowY:"auto", flex:1 }}>
          <div style={{ display:"flex", flexDirection:"column", gap:24 }}>
            <div style={{ aspectRatio:"2/3", background:"#e8e4dc", overflow:"hidden", borderRadius:2, boxShadow:"0 12px 32px rgba(0,0,0,0.15)" }}>
              <CoverImage book={book} showMetaOnFallback={true} />
            </div>
            <div>
              <div style={{ fontFamily:FONT_MONO, fontSize:10, color:MUTED, letterSpacing:"0.15em", marginBottom:12 }}>YOUR RATING</div>
              <StarRating value={myRating} onChange={async function(r) { await onUpdate(book.id, function(b) { var rt = Object.assign({}, b.ratings||{}); if(r>0) rt[currentUser]=r; else delete rt[currentUser]; return Object.assign({},b,{ratings:rt}); }); }} size={22} />
              {ratingEntries.length > 0 && (
                <div style={{ display:"flex", alignItems:"baseline", gap:8, marginTop:10, paddingTop:10, borderTop:"1px dashed "+RULE_SOFT }}>
                  <span style={{ fontFamily:FONT_DISPLAY, fontSize:28, fontWeight:500, letterSpacing:"-0.02em" }}>{avgRating.toFixed(1)}</span>
                  <span style={{ fontFamily:FONT_MONO, fontSize:10, color:MUTED, letterSpacing:"0.1em", textTransform:"uppercase" }}>avg &middot; {ratingEntries.length} rating{ratingEntries.length!==1?"s":""}</span>
                </div>
              )}
            </div>
            <div>
              <div style={{ fontFamily:FONT_MONO, fontSize:10, color:MUTED, letterSpacing:"0.15em", marginBottom:12 }}>YOUR STATUS</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
                {Object.entries(STATUSES).map(function(entry) {
                  var k = entry[0]; var s = entry[1]; var Icon = s.icon; var active = myStatus === k;
                  return (
                    <button key={k} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", background:active?INK:"transparent", color:active?BG:INK, border:"1px solid "+(active?INK:RULE_SOFT), borderRadius:999, fontSize:12, cursor:"pointer", fontFamily:FONT_SANS }} onClick={async function() { await onUpdate(book.id, function(b) { var rd=Object.assign({},b.readers); rd[currentUser]=k; return Object.assign({},b,{readers:rd}); }); }}>
                      <Icon size={13} strokeWidth={2.2} /> {s.label}
                    </button>
                  );
                })}
                {myStatus && (
                  <button style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:7, background:"transparent", border:"1px solid "+RULE_SOFT, borderRadius:999, color:MUTED, cursor:"pointer" }} onClick={async function() { await onUpdate(book.id, function(b) { var rd=Object.assign({},b.readers); delete rd[currentUser]; var rt=Object.assign({},b.ratings||{}); delete rt[currentUser]; return Object.assign({},b,{readers:rd,ratings:rt}); }); }}>
                    <Trash2 size={12} strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column" }}>
            <div style={{ fontFamily:FONT_MONO, fontSize:10, color:MUTED, letterSpacing:"0.2em", marginBottom:10 }}>VOLUME #{String((hashString(book.id||"")%999)+1).padStart(3,"0")}</div>
            <h2 style={{ fontFamily:FONT_DISPLAY, fontSize:"clamp(36px,4vw,52px)", fontWeight:400, margin:"0 0 8px", lineHeight:1.0, letterSpacing:"-0.035em" }}>{book.title}</h2>
            <div style={{ fontFamily:FONT_SERIF, fontSize:20, fontStyle:"italic", color:MUTED, marginBottom:6 }}>{book.author}</div>
            {book.year && <div style={{ fontFamily:FONT_MONO, fontSize:11, color:MUTED, letterSpacing:"0.1em" }}>Published {book.year}</div>}
            {book.addedBy && <div style={{ fontFamily:FONT_SERIF, fontSize:13, fontStyle:"italic", color:MUTED, marginTop:8 }}>Added by {book.addedBy}</div>}
            <GenreEditor currentGenre={genreForBook(book)} onChange={async function(g) { await onUpdate(book.id, function(b) { return Object.assign({},b,{genre:g||null}); }); }} />
            {readerList.length > 0 && (
              <div style={{ marginTop:36, paddingTop:24, borderTop:"1px solid "+RULE }}>
                <div style={{ fontFamily:FONT_MONO, fontSize:10, color:MUTED, letterSpacing:"0.15em", marginBottom:12 }}>THE CIRCLE</div>
                <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                  {readerList.map(function(entry) {
                    var key = entry[0]; var status = entry[1];
                    var name = displayNameFor(key);
                    var tr = book.ratings && book.ratings[key];
                    return (
                      <div key={key} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0", fontFamily:FONT_SERIF }}>
                        <span style={{ fontSize:16, fontWeight:500 }}>{name}</span>
                        <span style={{ color:MUTED }}>&middot;</span>
                        <span style={{ fontSize:14, fontStyle:"italic", color:MUTED }}>{(STATUSES[status] && STATUSES[status].label) || status}</span>
                        {tr > 0 && <span style={{ marginLeft:"auto" }}><StarRating value={tr} size={11} readOnly={true} /></span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ marginTop:36, paddingTop:24, borderTop:"1px solid "+RULE }}>
              <div style={{ fontFamily:FONT_MONO, fontSize:10, color:MUTED, letterSpacing:"0.15em", marginBottom:12, display:"inline-flex", alignItems:"center", gap:6 }}>
                <MessageCircle size={11} strokeWidth={2} /> CONVERSATION ({(book.reviews||[]).length})
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:16, marginBottom:16 }}>
                {(book.reviews||[]).length === 0 ? (
                  <div style={{ fontFamily:FONT_SERIF, fontStyle:"italic", color:MUTED, fontSize:15, padding:"8px 0" }}>No thoughts yet.</div>
                ) : (book.reviews||[]).map(function(rv) {
                  return (
                    <div key={rv.id} className="reviewItem">
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                        <span style={{ fontFamily:FONT_SANS, fontSize:13, fontWeight:600 }}>{rv.author}</span>
                        <span style={{ fontFamily:FONT_MONO, fontSize:10, color:MUTED }}>{new Date(rv.at).toLocaleDateString(undefined, { month:"short", day:"numeric" })}</span>
                        {rv.author === currentUser && (
                          <button className="reviewItemDelete" style={{ marginLeft:"auto", background:"transparent", border:"none", color:MUTED, cursor:"pointer", padding:4, opacity:0 }} onClick={async function() { await onUpdate(book.id, function(b) { return Object.assign({},b,{reviews:(b.reviews||[]).filter(function(r) { return r.id !== rv.id; })}); }); }}>
                            <Trash2 size={11} strokeWidth={2} />
                          </button>
                        )}
                      </div>
                      <div style={{ fontFamily:FONT_SERIF, fontSize:16, lineHeight:1.5, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{rv.text}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display:"flex", gap:8, alignItems:"flex-end", paddingTop:16, borderTop:"1px solid "+RULE }}>
                <textarea style={{ flex:1, padding:"10px 14px", fontSize:15, border:"1px solid "+RULE_SOFT, borderRadius:4, background:"transparent", resize:"none", minHeight:44, maxHeight:120, fontFamily:FONT_SERIF, outline:"none", lineHeight:1.4 }} placeholder="Share a thought..." value={reviewText} onChange={function(e) { setReviewText(e.target.value); }} onKeyDown={function(e) { if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)) postReview(); }} />
                <button style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 16px", background:INK, color:BG, border:"none", borderRadius:999, fontSize:12, fontFamily:FONT_SANS, opacity:reviewText.trim()?1:0.3, cursor:reviewText.trim()?"pointer":"default" }} onClick={postReview} disabled={!reviewText.trim()}>Post <Send size={13} strokeWidth={2} /></button>
              </div>
            </div>
            {book.addedBy === currentUser && readerList.length === 0 && (
              <button style={{ display:"flex", alignItems:"center", alignSelf:"flex-start", gap:6, marginTop:24, padding:"8px 14px", background:"transparent", color:"#C62828", border:"1px solid rgba(198,40,40,0.25)", borderRadius:999, fontSize:12, cursor:"pointer", fontFamily:FONT_SANS }} onClick={function() { onRemove(book.id); }}>
                <Trash2 size={12} strokeWidth={2} /> Remove from library
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Global CSS ─────────────────────────────────────────────────────────────

var GLOBAL_CSS = "@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');\n* { box-sizing: border-box; }\nbody { margin: 0; -webkit-font-smoothing: antialiased; }\n@keyframes fadeIn { from { opacity:0; } to { opacity:1; } }\n@keyframes spineIn { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:translateY(0); } }\n@keyframes stackSlideIn { from { opacity:0; transform:translateY(32px); } to { opacity:1; } }\n@keyframes stackTremble { 0%,100% { transform:translateX(0); } 10% { transform:translateX(-4px) rotate(-0.6deg); } 20% { transform:translateX(4px) rotate(0.6deg); } 35% { transform:translateX(-3px) rotate(-0.4deg); } 50% { transform:translateX(3px) rotate(0.4deg); } 65% { transform:translateX(-2px); } 80% { transform:translateX(2px); } }\n@keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(12px) scale(0.93); } to { opacity:1; transform:translateX(-50%) translateY(0) scale(1); } }\n@keyframes resultIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }\n@keyframes laneIn { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }\n@keyframes overlayIn { from { opacity:0; } to { opacity:1; } }\n@keyframes sheetIn { from { transform:translateY(100%); } to { transform:translateY(0); } }\n@keyframes dropdownIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }\n@keyframes dotBounce { 0%,80%,100% { transform:translateY(0); } 40% { transform:translateY(-6px); } }\n.spin { animation:spin 1s linear infinite; }\n@keyframes spin { to { transform:rotate(360deg); } }\n.blob { position:absolute; border-radius:50%; filter:blur(80px); opacity:0.5; }\n.blob-1 { width:620px; height:620px; background:radial-gradient(circle,#E63946 0%,transparent 70%); top:-10%; left:-10%; animation:drift1 32s ease-in-out infinite; }\n.blob-2 { width:540px; height:540px; background:radial-gradient(circle,#3A86FF 0%,transparent 70%); top:40%; right:-8%; animation:drift2 38s ease-in-out infinite; }\n.blob-3 { width:480px; height:480px; background:radial-gradient(circle,#FCBF49 0%,transparent 70%); bottom:-5%; left:30%; animation:drift3 44s ease-in-out infinite; }\n.blob-4 { width:420px; height:420px; background:radial-gradient(circle,#06A77D 0%,transparent 70%); top:20%; left:45%; animation:drift4 50s ease-in-out infinite; opacity:0.35; }\n@keyframes drift1 { 0%,100%{transform:translate(0,0) scale(1);} 33%{transform:translate(80px,60px) scale(1.15);} 66%{transform:translate(40px,120px) scale(0.9);} }\n@keyframes drift2 { 0%,100%{transform:translate(0,0) scale(1);} 33%{transform:translate(-70px,80px) scale(0.85);} 66%{transform:translate(-120px,-40px) scale(1.1);} }\n@keyframes drift3 { 0%,100%{transform:translate(0,0) scale(1);} 50%{transform:translate(100px,-80px) scale(1.2);} }\n@keyframes drift4 { 0%,100%{transform:translate(0,0) scale(1);} 25%{transform:translate(-60px,40px) scale(1.1);} 75%{transform:translate(80px,-50px) scale(1.05);} }\n.spine:hover { transform:translateY(-8px) !important; box-shadow:0 18px 40px rgba(0,0,0,0.18) !important; z-index:2; }.spine-picking { animation:spinePick 0.34s cubic-bezier(0.15,0,0.6,1) both !important; transform-origin:bottom center; }@keyframes spinePick { 0%{transform:translateY(0) rotateY(0deg) scale(1);} 35%{transform:translateY(-22px) rotateY(12deg) scale(1.04);} 65%{transform:translateY(-32px) rotateY(-6deg) scale(1.07);} 100%{transform:translateY(-28px) rotateY(0deg) scale(1.06);} }\n.add-spine:hover { border-color:#0E0E0E !important; color:#0E0E0E !important; }\n.searchPrompt:hover { background:#0E0E0E !important; color:#F5F1EA !important; }\n.recCard:hover { background:#F5F1EA !important; border-color:#0E0E0E !important; transform:translateY(-2px); }\n.nameBtn:hover { color:#E63946 !important; border-color:#E63946 !important; }\n.detailIconBtn:hover { background:#0E0E0E !important; color:#F5F1EA !important; }\n.reviewItem:hover .reviewItemDelete { opacity:1 !important; }\n::-webkit-scrollbar { width:10px; } ::-webkit-scrollbar-track { background:transparent; } ::-webkit-scrollbar-thumb { background:rgba(14,14,14,0.15); border-radius:5px; }\nbutton:focus-visible,input:focus-visible,textarea:focus-visible { outline:2px solid #0E0E0E; outline-offset:2px; }\n::selection { background:#E63946; color:#F5F1EA; }\n@media (max-width:820px) { [style*='grid-template-columns: 280px'] { grid-template-columns:1fr !important; } } .chipScroll::-webkit-scrollbar { display: none; } .chipScroll { -ms-overflow-style: none; scrollbar-width: none; } @keyframes forYouPulse { 0%,100% { box-shadow:0 3px 12px rgba(230,57,70,0.28); transform:scale(1); } 50% { box-shadow:0 6px 24px rgba(230,57,70,0.55); transform:scale(1.035); } } .forYouPulse { animation: forYouPulse 2.2s cubic-bezier(0.4,0,0.6,1) infinite; } @media (max-width:600px) { .spine { width: 64px !important; height: 260px !important; } .add-spine { width: 64px !important; height: 260px !important; } .forYouPulse { animation: none; } }";
