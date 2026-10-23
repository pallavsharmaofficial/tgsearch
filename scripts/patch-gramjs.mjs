// GramJS 2.26.22 ships TL layer 198, which predates Telegram's global post search.
// Add the newer channels.searchPosts (with `query`) + checkSearchPostsFlood definitions
// (constructor IDs match Telegram's current schema, same as Telethon 1.45).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const file = require.resolve("telegram/tl/apiTl.js");
let s = readFileSync(file, "utf8");
if (s.includes("checkSearchPostsFlood")) { console.log("gramjs already patched"); process.exit(0); }
const oldFn = /channels\.searchPosts#d19f987b[^\n]*\n/;
if (!oldFn.test(s)) throw new Error("searchPosts definition not found; GramJS version changed?");
s = s.replace(oldFn,
  "channels.searchPosts#f2c4f24d flags:# hashtag:flags.0?string query:flags.1?string offset_rate:int offset_peer:InputPeer offset_id:int limit:int allow_paid_stars:flags.2?long = messages.Messages;\n" +
  "channels.checkSearchPostsFlood#22567115 flags:# query:flags.0?string = SearchPostsFlood;\n");
s = s.replace("---functions---",
  "searchPostsFlood#3e0b5b6a flags:# query_is_free:flags.0?true total_daily:int remains:int wait_till:flags.1?int stars_amount:long = SearchPostsFlood;\n---functions---");
writeFileSync(file, s);
console.log("gramjs patched: channels.searchPosts(query) + checkSearchPostsFlood");
