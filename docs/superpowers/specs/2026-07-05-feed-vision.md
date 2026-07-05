# The Feed — the hook (owner vision, 2026-07-05)

Owner verbatim: "we are missing a hook. nothing about this feels like its breathing. we are all about intent, the main pages should not be dull, or with a lot of graphs, they SHOULD be the overview of intent of org knowledge, its like the feed of the company and we are creating content for them. there is the trending stuff if its a subject that is hot right now I would expect to have overview in an engaging way... clearing initial overview which is genuine and show we know you really well. we start org and there could also be lenses according to the user position in the company. same in the lens focus, the feature should have a top level page by default and also we have chat that starts after that. when you press something it should feel like infinite chat, so pressing a certain topic in the main page would scroll down show you the overview and maybe ask you something or just wait for you."

## The model

1. **The Brain is an editor.** It CREATES content from org knowledge — engaging, genuine overviews, not dashboards. The main page is the feed of the company.
2. **Trending is real.** Heat = activity density (events/moments per feature/topic, recency-weighted). A hot subject earns an editorial overview in the feed — written from the digests, cited.
3. **Genuine and personal** — "shows we know you really well." Opens with the org lens; later, lenses by the user's position in the company (exec/product/engineer roles).
4. **Infinite chat is the interaction.** One continuous stream: pressing anything (a trending topic, a feature) scrolls down and materializes its overview as new content in the stream — then the Brain asks a question or waits. Content and conversation are the same medium.
5. **Feature lens = top-level page first** (the feature's own engaging overview), chat starts after it.

## Implications

- Backend: a feed composer — trending detection over activity_events (density × recency per feature/topicFingerprint) + LLM-written editorial overviews grounded in digests (cited, essence-principle terse), cached and refreshed as the river moves.
- The lens rail, warm cream/grotesk language, and pure-chat mechanics survive; the CONTENT model changes from stats to editorial.
- Role lenses: future — rail slots by position in the company.

## Amendment (owner, same day): the mechanic is uniform across lenses

Verbatim: "same logic should be the same for any lens, if I pick a feature, there should be the overview, so the specific feature selection is opening a chat with the top level understanding a recent insights and" — "and the ability to approve pending stuff for that feature inline."

Selecting ANY lens = opening a chat seeded with that lens's editorial overview as its first turn: top-level understanding + recent insights, then the Brain engages or waits. Not "page then chat" — the overview IS the chat's opening content. One mechanic at every altitude: org feed, feature story, trending unfold. Future role lenses inherit the same shape.

The lens's seeded opening therefore carries three things: top-level understanding, recent insights, and that lens's pending approvals as inline actionable cards (stamp without leaving the chat).

## Voice rule (owner, binding on all user-facing copy)

Verbatim: "the language is too poetic, the river and what not mindset developing this should not necessarily be how we want to interact with the users, story is a big role here, stating value but keeping the doors slightly open to have the user eager to learn more. BUT - we can't be pretentious, because this is not how I am."

Rules: internal metaphors (river, sittings, ink, correspondence) are DEVELOPMENT vocabulary — never user-facing copy. The product speaks plainly: state the value, tell the story straight, end with a slight opening (a concrete question or an unresolved thread) that makes the reader want the next layer. No cleverness about itself, no mysticism, no literary posturing. The test: would the owner say this sentence out loud to a colleague? If not, rewrite it.

## The personal layer + the name (owner, 2026-07-05)

Verbatim: "we need a hook, something that would make this personal, like avatar of people in the org next to stuff, something that can actually be engaging, notifications think please and what should we name it (not brain) this is dull and not intriguing, you want to ask yourself why did they call it like that, then think hard and then you convince yourself you understood but the name was mere nonsense that made you imagine."

1. **People in the feed**: avatars of org members next to the work — decisions, sessions, approvals carry faces. The feed is about people's work, not abstract events. (Agents get marks too — visibly non-human.)
2. **Notifications**: the product reaches out — a gate waits for you, your area moved, something you decided got contradicted. Engagement, not noise.
3. **The name** (replacing "Brain"): the naming philosophy is binding — a name that provokes "why did they call it that?", rewards theory-building, and never resolves; evocative near-nonsense that makes you imagine. Not descriptive, not dull.
