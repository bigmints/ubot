import re

with open('src/api/index.ts', 'r') as f:
    content = f.read()

# 1. Add import
content = content.replace(
    "import { createApprovalStore, type ApprovalStore } from '../automation/approvals/service.js';",
    "import { createApprovalStore, type ApprovalStore } from '../automation/approvals/service.js';\nimport { ContactStore } from '../data/contact-store.js';"
)

# 2. Add global variable
content = content.replace(
    "let coreDb: DatabaseConnection | null = null;",
    "let coreDb: DatabaseConnection | null = null;\nlet contactStore: ContactStore | null = null;"
)

# 3. Instantiate
content = content.replace(
    "coreDb = db as unknown as DatabaseConnection;",
    "coreDb = db as unknown as DatabaseConnection;\n    contactStore = new ContactStore(coreDb);"
)

# 4. Add to getApiContext
content = content.replace(
    "    asyncJobStore,",
    "    asyncJobStore,\n    contactStore,"
)

# 5. Add to deps in WhatsApp
content = re.sub(
    r'(const deps: UnifiedDeps = \{[^\}]+?)(\s*saveConfigValue,)',
    r'\1  contactStore,\2',
    content,
    flags=re.DOTALL
)

with open('src/api/index.ts', 'w') as f:
    f.write(content)

