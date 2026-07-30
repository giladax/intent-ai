# SOTA Knowledge & Agentic-Memory Research Dossier

**Date:** 2026-07-19
**For:** Quire — semantic map (signed record: entities / promises with live verdicts / signed decisions + unsigned "working mind": free-form LLM-created nodes grounded in evidence)
**Brief:** survey frontier-lab memory work, GraphRAG descendants, schema-free KG construction, reasoning-over-graphs, and guru commentary (2024–2026). Name each finding, cite it, explain the mechanism, map it to our stack. Include what the evidence says does NOT work. Rank top-8 by adoptability.

**Quire stack vocabulary used in mappings:** *atoms* (evidence units), *relevance vectors* (what-matters-to-what scoring), *working mind* (unsigned LLM node layer), *signed record* (human-signed entities/promises/decisions), *stories* (narrative summaries over evidence).

---

## 1. Frontier-lab approaches to agentic memory & knowledge

### 1.1 Anthropic — Memory Tool + Context Editing (client-side, file-shaped memory)
**Source:** [Memory tool — Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool); [Context management blog](https://claude.com/blog/context-management); [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
Released Sept 2025 (`memory_20250818`, now GA): the model makes explicit tool calls against a `/memory` file directory that *the client* executes and stores — memory is plain files the host application owns, not an opaque server-side store. Paired with automatic context editing (evicting stale tool results past a token threshold), Anthropic reports ~84% token reduction on long agentic workflows. The design bet: memory as a legible, inspectable artifact the agent curates itself, with the harness deciding persistence.
**Quire mapping:** validates our "working mind as explicit, inspectable nodes the LLM writes deliberately" — memory operations as first-class events we can journal, diff, and later promote into the signed record.

### 1.2 Anthropic — Contextual Retrieval (prepend situating context to every atom)
**Source:** [Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval) (Sept 2024)
Before embedding a chunk, an LLM writes a short chunk-specific preamble situating it in the whole document ("This chunk is from X's Q2 filing, discussing…"), then both contextualized embeddings and contextual BM25 are indexed. Reduced top-20 retrieval failure rate by 49%, and by 67% with reranking added — one of the best-evidenced cheap wins in retrieval, made economical by prompt caching. It is deliberately *not* a graph: structure is pushed into the atom itself rather than into edges.
**Quire mapping:** directly applicable to atoms — every evidence atom should carry LLM-written situating context (which session, which feature, why it mattered) at index time; this is the cheapest upgrade to our relevance vectors.

### 1.3 Anthropic — MCP Resources as the serving surface
**Source:** [MCP specification — Resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
MCP standardizes *resources* (URI-addressed context units with subscriptions/updates) alongside tools, letting a knowledge layer expose live, addressable knowledge nodes to any agent rather than answering only query-shaped requests. The ecosystem trend through 2025–26 is knowledge layers (Zep, Mem0, supermemory) shipping as MCP servers first.
**Quire mapping:** our working-mind nodes and signed records should be URI-addressable MCP resources (not just search results), so agents can subscribe to a promise's verdict changing.

### 1.4 OpenAI — "Dreaming": background memory consolidation + revision
**Source:** [Dreaming: Better memory for a more helpful ChatGPT](https://openai.com/index/chatgpt-memory-dreaming/); [Memory and new controls](https://openai.com/index/memory-and-new-controls-for-chatgpt/); reverse-engineering: [llmrefs](https://llmrefs.com/blog/reverse-engineering-chatgpt-memory)
ChatGPT memory evolved from user-triggered "saved memories" (April 2024) to an automatic background process ("dreaming") that curates, synthesizes, and — critically — *revises* memories as time passes ("you are going to Singapore in July" → "you went to Singapore in July 2026"). Their own evals show the older architecture was mediocre (factual recall 67.9%, accuracy-over-time 52.2%) and the consolidation-based one substantially better (82.8% / 75.1%) — i.e., the win came from offline synthesis + staleness handling, not from fancier retrieval. Reverse-engineering suggests injected context is a compiled digest, not raw memory dumps.
**Quire mapping:** the working mind needs a "dreaming" pass — a background loop that revises/merges/expires unsigned nodes as evidence ages — and staleness is a first-class enemy, which our signed-verdict-from-code-checks design already handles for promises.

### 1.5 Google / DeepMind — reasoning-mode over structure, thin on explicit KG+Gemini
**Source:** [Gemini Deep Think](https://deepmind.google/blog/accelerating-mathematical-and-scientific-discovery-with-gemini-deep-think/); adjacent academic work: [G-reasoner: Foundation Models for Unified Reasoning over Graph-structured Knowledge](https://arxiv.org/abs/2509.24276)
DeepMind's public direction is deep parallel reasoning (Deep Think) rather than an explicit knowledge-graph memory product; there is no strong public 2024–26 "Gemini + dynamic KG memory" line comparable to Zep or GraphRAG. The nearest research direction (G-reasoner and graph-foundation-model work) trains a small dedicated graph reasoner (~8M params) fused with an LLM, and finds it doesn't generalize across graph structures — evidence that "one graph model to rule them all" is premature. AlphaFold-style structured-reasoning transfer to org knowledge remains an analogy, not a result.
**Quire mapping:** no adoptable artifact here; the negative result (graph reasoners don't generalize) supports keeping our graph small, typed-by-use, and traversed by the LLM itself rather than a learned graph model.

### 1.6 Meta / Clune lab — ALMA: agents that design their own memory systems
**Source:** [Learning to Continually Learn via Meta-learning Agentic Memory Designs](https://arxiv.org/abs/2602.07755) (2026)
A meta-agent proposes memory architectures — schemas, retrieval mechanisms, update strategies — *as executable code*, evaluates them on sequential-decision benchmarks, and archives winners; learned designs beat every hand-crafted memory baseline (MemGPT-style included) on all four test domains. The provocation: the memory schema itself is a search space, not a design decision. Meta's other durable contribution here is Chain-of-Verification (§4.2).
**Quire mapping:** supports the founder's "no rules" instinct for the working mind — let node kinds/link types be emergent and empirically pruned — while the signed record stays the fixed, human-governed part.

---

## 2. GraphRAG and its descendants

### 2.1 Microsoft GraphRAG — community summaries as the real innovation
**Source:** [From Local to Global: A GraphRAG Approach to Query-Focused Summarization](https://arxiv.org/abs/2404.16130) (2024); repo: https://github.com/microsoft/graphrag
LLM extracts an entity/relation graph from the corpus, Leiden clustering finds hierarchical communities, and an LLM writes a summary *per community* — global "sensemaking" questions are answered by map-reducing over community summaries rather than retrieving chunks. Beat vector RAG on comprehensiveness/diversity for corpus-level questions; the durable idea is not the triples but the **pre-computed hierarchical summaries** (the graph is scaffolding for choosing what to summarize). Indexing cost is severe (full-corpus LLM extraction), and independent re-evaluation has challenged the win rates (§6).
**Quire mapping:** community summaries ≈ our stories — periodically cluster working-mind nodes + atoms and have the LLM write the summary of each cluster; that's the artifact humans read and sign, not the raw graph.

### 2.2 LazyGraphRAG — defer all expensive work to query time
**Source:** [LazyGraphRAG: Setting a new standard for quality and cost — Microsoft Research](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/) (Nov 2024)
Indexing does only lightweight noun-phrase graph construction (0.1% of GraphRAG's indexing cost, ~vector-RAG cost); at query time an iterative-deepening search (best-first + breadth-first over concept subgraphs) does relevance tests under an explicit budget, matching GraphRAG-global quality at >700× lower query cost. Microsoft's own follow-up is effectively an admission that eager full-graph summarization was mostly wasted compute.
**Quire mapping:** strong argument for our "small graph today, growing" posture — build cheap structure eagerly, spend LLM tokens lazily at question time, and let a per-question budget knob govern depth.

### 2.3 HippoRAG / HippoRAG 2 — hippocampal indexing via Personalized PageRank
**Source:** [HippoRAG](https://arxiv.org/abs/2405.14831) (NeurIPS 2024); [HippoRAG 2: From RAG to Memory](https://arxiv.org/abs/2502.14802) (2025); repo: https://github.com/OSU-NLP-Group/HippoRAG
Open-IE builds a schema-less concept graph; at query time, query entities seed **Personalized PageRank** over the graph, and activation spread ranks passages — single-step multi-hop retrieval that mimics hippocampal pattern completion. HippoRAG 2 adds passage nodes into the graph, deeper query-to-triple linking, and "recognition memory" filtering; it beats RAPTOR, GraphRAG, and LightRAG on associativity benchmarks (+7 F1 over SOTA embedders) while using far fewer tokens ([comparison](https://arxiv.org/pdf/2506.20963)).
**Quire mapping:** PPR over our node graph is a near-drop-in implementation of relevance vectors — seed from the entities in a question, let activation flow through working-mind links to surface non-obvious evidence atoms; cheap, deterministic, and works on small graphs.

### 2.4 RAPTOR — recursive abstractive trees
**Source:** [RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval](https://arxiv.org/abs/2401.18059) (ICLR 2024)
Cluster chunks by embedding, summarize each cluster, re-embed summaries, recurse — producing a tree where retrieval can hit any abstraction level; +20% accuracy on QuALITY with GPT-4. It's the "abstraction hierarchy without a graph" baseline, and later comparisons show HippoRAG 2 beating it — abstraction alone underperforms abstraction + associativity.
**Quire mapping:** confirms multi-level summaries (atom → story → epoch story) are worth having, but as a *view* over the graph rather than the primary structure — Quire already rejected trees as primary (journal-as-product).

### 2.5 LightRAG / nano-graphrag lineage — the commodity version
**Source:** [LightRAG](https://arxiv.org/abs/2410.05779) (HKU, 2024); repo: https://github.com/HKUDS/LightRAG; parent: https://github.com/gusye1234/nano-graphrag
nano-graphrag reimplemented GraphRAG minimally; LightRAG grew from it: entity/relation extraction into a flat graph, **dual-level retrieval** (low-level: specific entities/edges; high-level: themes via keyword-matched edge aggregation), incremental updates without full re-index. Cheaper than GraphRAG and hugely popular, but HippoRAG 2's evals and independent issue threads ([discrepancy report](https://github.com/OSU-NLP-Group/HippoRAG/issues/135)) show its quality claims are shakier than its adoption suggests.
**Quire mapping:** the dual-level query pattern (specific-entity lookup vs. theme-level question) is a good shape for our MCP query surface; the lineage's real lesson is incremental graph update, which we need since sessions arrive continuously.

---

## 3. Dynamic ontology / schema-free knowledge construction

### 3.1 Zep / Graphiti — bi-temporal knowledge graph for agent memory (closest to our domain)
**Source:** [Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956) (Jan 2025); repo: https://github.com/getzep/graphiti (~20k stars); [Neo4j writeup](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/)
Graphiti ingests episodes (messages, JSON, text) into a three-tier graph — episode subgraph (raw evidence, lossless), semantic entity subgraph (LLM-resolved entities + facts as edges), community subgraph (clustered summaries) — with a **bi-temporal model**: every edge carries both event-time and ingestion-time plus validity intervals, so new facts *invalidate* rather than overwrite old ones. Contradictions are resolved by edge invalidation with provenance retained; retrieval fuses semantic, BM25, and graph-distance search. Beat MemGPT on DMR (94.8% vs 93.4%) and improved LongMemEval by up to 18.5% at ~90% lower latency.
**Quire mapping:** this is the closest published system to Quire's whole design — episodes ≈ atoms, entity subgraph ≈ working mind, communities ≈ stories; the adoptable core is **validity intervals + non-destructive invalidation** on every working-mind edge, which is also exactly the semantics of a promise verdict flipping.

### 3.2 A-MEM — Zettelkasten agentic memory: notes that link and *evolve*
**Source:** [A-MEM: Agentic Memory for LLM Agents](https://arxiv.org/abs/2502.12110) (NeurIPS 2025); repo: https://github.com/WujiangXu/A-mem
Each new memory becomes a structured note (content, context description, keywords, tags); the system retrieves nearby historical notes and asks the LLM to decide which links to create — and, crucially, whether the *existing* notes' descriptions/tags should be **updated in light of the new note** (memory evolution). No fixed ontology; the network self-organizes, Zettelkasten-style. Outperformed SOTA memory baselines across six foundation models, strongest on multi-hop.
**Quire mapping:** this is the working mind's operating manual — on every new node, run a link-and-evolve pass over neighbors; the "new evidence retroactively re-describes old nodes" move is what turns a pile of observations into understanding.

### 3.3 MemGPT → Letta — memory blocks + sleep-time compute
**Source:** [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560) (2023); [Memory Blocks](https://www.letta.com/blog/memory-blocks/); [Sleep-time Compute](https://www.letta.com/blog/sleep-time-compute/) (2025)
MemGPT's OS framing (self-editing core memory + paged archival memory) matured into Letta's two durable ideas: (1) **memory blocks** — named, size-bounded, always-in-context units the agent rewrites deliberately; (2) **sleep-time compute** — a separate background agent that reorganizes and improves memory during idle periods, decoupling memory quality from response latency, writing to blocks shared across agents.
**Quire mapping:** our consolidation loop should be a sleep-time agent over the journal (Quire already digests sessions offline — this says: also re-digest the *graph itself*), and a few curated "block"-like summaries (current tensions, open questions) should be pinned into every agent's context via MCP.

### 3.4 Mem0 — extraction-then-update pipeline; graph variant barely pays
**Source:** [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/abs/2504.19413) (2025)
Pipeline: extract candidate memories from conversation, then an LLM chooses ADD/UPDATE/DELETE/NOOP against existing memories — an explicit reconciliation step rather than append-only storage. On LOCOMO: +26% over the OpenAI memory baseline, 91% lower p95 latency and >90% token savings vs full-context. The telling result: the graph variant (Mem0-g, Neo4j) adds only ~2% over the non-graph version — for *conversational* memory, reconciliation matters far more than graph structure.
**Quire mapping:** adopt the ADD/UPDATE/DELETE/NOOP reconciliation gate for working-mind writes (prevents node sprawl), and take the ~2% as a warning: our graph must earn its keep on *cross-session, cross-entity* questions, not chat recall.

### 3.5 AutoSchemaKG — schema induction instead of schema design
**Source:** [AutoSchemaKG: Autonomous KG Construction through Dynamic Schema Induction](https://arxiv.org/abs/2505.23628) (2025, ACL 2026)
LLMs extract triples (entities *and events* as first-class nodes) and simultaneously *induce* the schema by conceptualizing instances into multi-level semantic categories — no predefined ontology. Ran at web scale (50M docs → 900M nodes); induced schemas hit 95% semantic alignment with human-crafted ones. Evidence that "let the LLM invent the ontology, then organize it bottom-up" works, provided there's a conceptualization pass that groups raw nodes into categories after the fact.
**Quire mapping:** the working mind should get a periodic *conceptualization pass* — the LLM abstracts its own free-form nodes into emergent categories — giving us a soft ontology for navigation without ever imposing one up front.

### 3.6 Karpathy's LLM Wiki — compile knowledge into a legible artifact, don't re-retrieve
**Source:** Karpathy gist/pattern, April 2026; guides: [aibuilderclub](https://www.aibuilderclub.com/blog/karpathy-llm-wiki), [datasciencedojo tutorial](https://datasciencedojo.com/blog/llm-wiki-tutorial/)
Three layers: `raw/` (immutable sources), `wiki/` (LLM-synthesized, interlinked markdown pages — entity pages, concept pages, contradiction pages), and a schema file governing the agent. Instead of RAG-retrieving raw chunks per query, the agent *compiles* sources into the wiki once and answers from the compiled artifact; every added source and asked question enriches it. It's plain files — human-readable, diffable, git-versioned — and it went viral precisely because it's the anti-infrastructure position.
**Quire mapping:** strong convergent validation of the signed record + stories as *compiled, human-legible artifacts*; also suggests working-mind nodes should render as readable pages (with a "contradictions" node kind — Karpathy makes contradiction a first-class page type, matching our tensions).

---

## 4. Reasoning over graphs

### 4.1 Graph of Thoughts — thought graphs help on *decomposable* tasks
**Source:** [Graph of Thoughts: Solving Elaborate Problems with LLMs](https://arxiv.org/abs/2308.09687) (Besta et al., AAAI 2024); repo: https://github.com/spcl/graph-of-thoughts
Models the reasoning process as an arbitrary DAG — thoughts can be branched, merged, refined in loops — beating Tree-of-Thoughts on tasks like sorting (+62% quality, −31% cost). But the wins are on tasks with explicit decompose/merge structure; there's little evidence GoT-style topology helps open-ended synthesis, and follow-up analysis shows LLM graph reasoning degrades as graph scale/complexity grows ([graph-based analysis of reasoning LLMs](https://aclanthology.org/2025.emnlp-main.896.pdf)).
**Quire mapping:** use graph structure to organize *evidence and claims*, not to force the model's reasoning topology — the working mind is a substrate the LLM traverses, not a reasoning harness.

### 4.2 Chain-of-Verification (CoVe) — draft, plan checks, verify independently, revise
**Source:** [Chain-of-Verification Reduces Hallucination in LLMs](https://arxiv.org/abs/2309.11495) (Meta AI, 2023/2024)
The model drafts an answer, generates verification questions about its own claims, answers each *independently of the draft* (to avoid confirmation bias), then rewrites. Consistently reduces hallucination across list-QA and longform generation; the load-bearing detail is that verification must not condition on the draft.
**Quire mapping:** this is the mechanized version of our promises-with-verdicts — every working-mind claim node should carry LLM-generated verification questions whose answers come from atoms/code checks, independently of the claim's own text; verified claims are what humans get asked to sign.

### 4.3 KG-traversal prompting (MindMap and kin) — graphs as evidence scaffolding
**Source:** [MindMap: Knowledge Graph Prompting Sparks Graph of Thoughts](https://arxiv.org/abs/2308.09729) (2023/24); position: [How can Graphs Help LLMs?](https://arxiv.org/pdf/2605.02452)
Retrieved KG subgraphs are rendered into the prompt as explicit path/neighbor structures; the LLM reasons over the rendered structure and cites which nodes it used — improving groundedness and making the reasoning inspectable. The 2026 position-paper literature converges on graphs helping as **curated context that surfaces relations the model wouldn't juxtapose itself**, not as a computational substrate the LLM executes over.
**Quire mapping:** our MCP serving layer should return *rendered subgraphs* (nodes + typed edges + evidence pointers), not just node text — the juxtaposition is the value.

### 4.4 To CoT or not to CoT — the honest baseline on "does structure help"
**Source:** [To CoT or not to CoT?](https://arxiv.org/abs/2409.12183) (ICLR 2025; meta-analysis of 100+ papers, 20 datasets, 14 models)
Chain-of-thought's gains concentrate almost entirely on math/symbolic/logic tasks; on MMLU-style knowledge tasks, direct answering matches CoT unless the problem contains symbolic operations. The general lesson: added reasoning *structure* (chains, trees, graphs) mostly pays when the task has executable/verifiable substructure — which is why pairing structure with actual checkers (solvers, code checks) beats structure alone.
**Quire mapping:** Quire's edge is exactly the verifiable substructure — promises checked by code — so structured reasoning should be spent where verdicts are computable, and plain synthesis used elsewhere.

---

## 5. The gurus

### 5.1 Karpathy — knowledge should *compound* as a compiled artifact
**Source:** LLM Wiki pattern (§3.6); see also [Beyond RAG writeup](https://levelup.gitconnected.com/beyond-rag-how-andrej-karpathys-llm-wiki-pattern-builds-knowledge-that-actually-compounds-31a08528665e)
His implicit critique of the whole retrieval industry: re-retrieving raw chunks per query wastes the synthesis work; compile once into legible pages, keep raw sources immutable underneath, let queries improve the artifact. Plain markdown over vector DBs and graph infra — legibility and git-diffability are features, not compromises.
**Quire mapping:** already covered — but note his three-layer split (immutable raw / synthesized / schema) mirrors atoms / working mind / signed record almost exactly.

### 5.2 Simon Willison — memory as loss of context ownership; injection risk
**Source:** AI Engineer World's Fair remarks, recounted in [LangChain's context-engineering post](https://www.langchain.com/blog/context-engineering-for-agents); ongoing at simonwillison.net
His running skeptical thread: automatic memory retrieval means "the context window no longer belongs to you" — his canonical example is ChatGPT silently injecting his location from memory into a generated image. He treats every memory system as a prompt-injection surface and argues for user-visible, user-editable memory over ambient recall.
**Quire mapping:** the signed/unsigned split is our answer — unsigned working-mind nodes must be visibly marked as machine-conjecture when served over MCP, and never silently injected as if they were signed truth.

### 5.3 Harrison Chase (LangChain) — context engineering > memory architecture
**Source:** [The rise of context engineering](https://www.langchain.com/blog/the-rise-of-context-engineering); [Sequoia Training Data podcast](https://sequoiacap.com/podcast/context-engineering-our-way-to-long-horizon-agents-langchains-harrison-chase/) (2025)
His claim from watching thousands of production agents: most failures are context failures, not model failures; the winning abstractions are boring — file systems as agent state, to-do lists as planning, "put complexity in the prompt." LangChain's own memory products moved *away* from fancy graph memory toward files + summaries + retrieval, which is a revealed-preference data point.
**Quire mapping:** our graph's job is to *produce great context packets* for agents (brain_enter, feature context), and it should be judged only on that — the ETC/CVR harness framing is exactly right by this school.

### 5.4 Tools-for-thought lineage (Matuschak-adjacent) — evolving notes, emergent structure
**Source:** A-MEM's explicit Zettelkasten grounding (§3.2); Karpathy-wiki's Obsidian-vault deployments (§3.6)
The 2025–26 convergence: the tools-for-thought principles (atomic notes, dense linking, notes revised as understanding grows, structure emergent rather than imposed) got mechanized into agent memory systems and *won benchmarks* — A-MEM is literally Zettelkasten-as-algorithm at NeurIPS. The part that did not transfer: heavy manual curation rituals; the LLM does the linking now, humans do the signing.
**Quire mapping:** working mind = machine Zettelkasten, signed record = the human curation ritual reduced to its highest-value act (signing), which is precisely the division of labor this lineage arrived at.

---

## 6. What the evidence says DOESN'T work

1. **Eager full-graph LLM indexing.** LazyGraphRAG matches full GraphRAG global-query quality at 0.1% of the indexing cost and ~700× lower query cost ([Microsoft Research](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/)) — most eager summarization compute is wasted on communities nobody ever asks about.
2. **GraphRAG's headline win rates don't fully survive rigorous evaluation.** An unbiased-evaluation framework ([arXiv 2506.06331](https://arxiv.org/html/2506.06331v1)) finds the original LLM-judged comparisons ask corpus-mismatched questions and carry judge bias; real gains exist for global sensemaking but are smaller than advertised, and the original paper covered only two ~1M-token corpora.
3. **Graph structure per se barely improves conversational/recall memory.** Mem0's graph variant adds ~2% over its non-graph version ([arXiv 2504.19413](https://arxiv.org/abs/2504.19413)); the big wins came from the extract-then-reconcile pipeline. Graphs pay on multi-hop, cross-entity, temporal questions — not on "what did the user say."
4. **Structured reasoning without verifiable substructure is decoration.** CoT (and by extension thought-trees/graphs) helps mainly on math/symbolic tasks; on knowledge tasks direct answering ties it ([To CoT or not to CoT](https://arxiv.org/abs/2409.12183)); LLM graph-reasoning quality also degrades as graphs grow ([EMNLP 2025 analysis](https://aclanthology.org/2025.emnlp-main.896.pdf)).
5. **Unreconciled extraction pipelines hallucinate the graph.** Production post-mortems consistently name entity/relation hallucination and duplicate-entity sprawl as the top KG-RAG failure, requiring expensive manual repair ([production failure surveys](https://www.teacherandtask.com/blog/advanced-rag-patterns-2026-production-engineering-guide)); every serious system (Graphiti, Mem0, AutoSchemaKG) has an explicit dedup/invalidate/reconcile stage.
6. **Static memories go stale and then go wrong.** OpenAI's own numbers: accuracy-over-time was 52.2% under append-only saved memories, 75.1% after revision-based consolidation ([Dreaming](https://openai.com/index/chatgpt-memory-dreaming/)) — memory without an expiry/revision mechanism becomes actively harmful.
7. **Ambient memory injection erodes trust.** Willison's location-injection example: silent recall into unrelated outputs makes users feel the context "no longer belongs to them" — memory must be attributable and visible.
8. **Learned graph-reasoning models don't generalize.** Graph foundation models trained on specific KGs fail to transfer to other graph structures ([G-reasoner discussion](https://arxiv.org/abs/2509.24276)) — no shortcut around LLM-mediated traversal for a bespoke graph like ours.

---

## 7. Top-8 by adoptability for Quire

Ranked for: small evidence-grounded graph today, growing; human-signed core; MCP-served; session-stream ingestion already in place.

| # | Finding | Why it ranks here |
|---|---------|-------------------|
| 1 | **Graphiti-style bi-temporal edges with validity intervals** (§3.1) | Closest published system to our whole domain; non-destructive invalidation is exactly promise-verdict semantics; adoptable as two timestamp fields + an invalidation rule on working-mind edges, today. |
| 2 | **A-MEM link-and-evolve pass** (§3.2) | Directly defines how the working mind should behave on every new node: retrieve neighbors, LLM decides links, retroactively re-describe old nodes; benchmark-validated, cheap at our scale. |
| 3 | **Mem0's ADD/UPDATE/DELETE/NOOP reconciliation gate** (§3.4) | The single best-evidenced defense against node sprawl and graph hallucination; a small prompt + one LLM call per write. |
| 4 | **Letta sleep-time compute** (§3.3) | We already digest sessions offline; extend it to re-digest the graph — consolidation as a background agent, decoupled from serving latency. |
| 5 | **Community/cluster summaries as stories, built lazily** (§2.1 + §2.2) | GraphRAG's durable idea shaped by LazyGraphRAG's cost lesson: cluster working-mind nodes, summarize on demand under a budget — this is the stories layer with evidence. |
| 6 | **Contextual retrieval for atoms** (§1.2) | Best-evidenced cheap retrieval win (−49–67% failure rate); one situating sentence per atom at index time, straight into our existing search. |
| 7 | **Personalized PageRank relevance (HippoRAG)** (§2.3) | Deterministic, token-free multi-hop relevance over exactly the kind of graph we have; implements relevance vectors without an LLM in the loop. |
| 8 | **CoVe-style independent verification on claim nodes** (§4.2) | Mechanizes signing: each claim node carries verification questions answered from evidence/code checks independently of the claim — the bridge from working mind to signed record. |

Honorable mentions: OpenAI-style memory revision/expiry (fold into #4's sleep-time agent), AutoSchemaKG conceptualization pass (fold in once node count justifies it), Karpathy-wiki legible rendering (an output format decision, not an architecture one), MCP resources with subscriptions for verdict changes (serving-layer roadmap).

### Top-3 don't-do
1. **Don't eagerly index/summarize the whole graph** — LazyGraphRAG proved ~99.9% of that compute is avoidable; build cheap structure eagerly, spend LLM tokens at question time under a budget.
2. **Don't expect graph structure alone to improve answers** — Mem0's +2% and the CoT meta-analysis say structure pays only where there's multi-hop/temporal need or verifiable substructure; judge the graph solely on context-packet quality (ETC/CVR).
3. **Don't let LLM writes into the graph go unreconciled or unexpiring** — entity hallucination/duplication is the #1 production KG failure, and append-only memory decays to ~52% accuracy over time; every write goes through a reconcile gate, every edge carries validity.
