const fs = require('fs');
const path = require('path');

function replaceInFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;

    // We replace bg-gray-950 text-white with bg-cs-primary text-white
    const regex1 = /bg-gray-950/g;
    const regex2 = /hover:bg-gray-800/g;
    const regex3 = /border-gray-950/g;

    // But let's only replace if it's not a <pre> block. Or we can just globally replace.
    // In ContractAgentPanel.tsx:
    if (filePath.includes('ContractAgentPanel.tsx')) {
        // don't mess up the pre block
    } else {
        if (regex1.test(content) || regex2.test(content) || regex3.test(content)) {
            content = content.replace(regex1, 'bg-cs-primary').replace(regex2, 'hover:bg-cs-primary/90').replace(regex3, 'border-cs-primary');
            changed = true;
        }
    }

    if (filePath.endsWith('dashboard/page.tsx')) {
        // add useRouter if missing
        if (!content.includes('useRouter')) {
            content = content.replace('useSearchParams } from "next/navigation";', 'useRouter, useSearchParams } from "next/navigation";');
            // add useRouter hook inside DashboardContent
            content = content.replace('const searchParams = useSearchParams();', 'const router = useRouter();\n  const searchParams = useSearchParams();');
            changed = true;
        }

        // change tab click
        const tabClickTarget = `onClick={() => setProjectTab(tab.id as ProjectTab)}`;
        const tabClickReplacement = `onClick={() => {\n                      if (tab.id === "reviews") {\n                        router.push(\`/tabular-reviews?project_id=\${encodeURIComponent(selectedProject._id)}\`);\n                      } else {\n                        setProjectTab(tab.id as ProjectTab);\n                      }\n                    }}`;
        if (content.includes(tabClickTarget)) {
            content = content.replace(tabClickTarget, tabClickReplacement);
            changed = true;
        }
    }

    if (changed) {
        fs.writeFileSync(filePath, content);
        console.log(`Updated ${filePath}`);
    }
}

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walkDir(fullPath);
        } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
            replaceInFile(fullPath);
        }
    }
}

walkDir('/Users/kunaldhamiwal/dev/contractsense/apps/frontend/app');
walkDir('/Users/kunaldhamiwal/dev/contractsense/apps/frontend/components');
