const fs = require('fs');
const file = '/Users/wade/work-space/vide-work/OpenChatCut/src/App.tsx';
let s = fs.readFileSync(file, 'utf8');

const replacements = [
  // 1. onDone signature: receive full ProjectMeta
  ["function ImportHandler({ articleId, onDone }: { articleId: string; onDone: (projectId: string) => void }) {",
   "function ImportHandler({ articleId, onDone }: { articleId: string; onDone: (project: ProjectMeta) => void }) {"],
  // 2. pass the created project meta (not just id)
  ["        // 5. Navigate to the editor\n        onDone(project.id);\n",
   "        // 5. Navigate to the editor (refresh the project list so the editor\n        //    route can resolve the freshly-created project instead of bouncing back)\n        onDone(project);\n"],
  // 3. App-level onDone: add project to state, then navigate
  ["      <ImportHandler\n        articleId={route.articleId}\n        onDone={(projectId) => go(`#/editor/${projectId}`)}\n      />",
   "      <ImportHandler\n        articleId={route.articleId}\n        onDone={(project) => {\n          setProjects((prev) => [project, ...(prev ?? []).filter((p) => p.id !== project.id)]);\n          go(`#/editor/${project.id}`);\n        }}\n      />"],
];

let made = 0;
for (const [from, to] of replacements) {
  if (!s.includes(from)) {
    console.error('NOT FOUND:\n---\n' + from + '\n---');
    continue;
  }
  s = s.split(from).join(to);
  made++;
}
fs.writeFileSync(file, s);
console.log('Applied', made, 'of', replacements.length, 'replacements');