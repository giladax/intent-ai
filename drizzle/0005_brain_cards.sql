CREATE TABLE brain_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_name TEXT NOT NULL,
  level TEXT NOT NULL,
  path TEXT,
  parent_node TEXT,
  summary TEXT NOT NULL,
  insights JSONB NOT NULL DEFAULT '[]',
  files JSONB DEFAULT '[]',
  exports JSONB DEFAULT '[]',
  related JSONB DEFAULT '[]',
  children JSONB DEFAULT '[]',
  sessions JSONB DEFAULT '[]',
  version_id UUID REFERENCES brain_versions(id),
  repo_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(repo_id, node_name)
);
