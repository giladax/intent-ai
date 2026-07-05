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
