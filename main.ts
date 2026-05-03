import {
  App,
  ItemView,
  MarkdownView,
  Modal,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  setIcon,
  TFile,
  TFolder,
  WorkspaceLeaf,
  normalizePath
} from "obsidian";

declare const require: (module: string) => { execFile?: ExecFileFn };

const VIEW_TYPE = "md-ai-writer-view";
const APP_NAME = "NoteCraft AI";
const SETTINGS_PROFILE_CODE_BLOCK = "notecraft-ai-settings";
const DEFAULT_SETTINGS_PROFILE_PATH = "md-ai-writer/settings-profile.md";

type ChatRole = "system" | "user" | "assistant";
type ProviderId = "deepseek" | "custom";
type ProviderApiMode = "chat_completions" | "responses";
type ReasoningEffort = "high" | "max";
type CliToolName = "search" | "read" | "tasks" | "tags" | "unresolved" | "daily" | "files";
type ChatMode = "chat" | "edit" | "knowledge" | "new";
type UiLanguage = "zh" | "en";
type ExecFileFn = (
  file: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean; maxBuffer: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void
) => void;

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  models: string;
  apiMode: ProviderApiMode;
  omitSamplingParams?: boolean;
}

interface CustomProviderConfig extends ProviderConfig {
  id: string;
  name: string;
}

interface ChatHistoryItem {
  title: string;
  prompt: string;
  createdAt: number;
  answer?: string;
}

type ContextSelection =
  | { type: "file"; path: string }
  | { type: "history"; item: ChatHistoryItem };

interface Settings {
  provider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
  customProviders: CustomProviderConfig[];
  activeCustomProviderId: string;
  preferredChatMode: ChatMode;
  temperature: number;
  topP: number | null;
  frequencyPenalty: number | null;
  maxTokens: number;
  systemPrompt: string;
  quickPrompts: QuickPrompt[];
  suggestedPrompts: string;
  chatHistory: ChatHistoryItem[];
  enableMemory: boolean;
  memoryFilePath: string;
  agentTools: Record<string, boolean>;
  obsidianCliPath: string;
  obsidianCliVault: string;
  obsidianCliTimeoutMs: number;
  useJsonOutputForActions: boolean;
  sendDeepSeekThinkingOptions: boolean;
  deepSeekThinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  confirmBeforeApply: boolean;
  includeActiveNoteByDefault: boolean;
  knowledgeFolders: string[];
  voyageApiKey: string;
  voyageRerankModel: string;
  knowledgeMaxCandidates: number;
  knowledgeTopK: number;
  uiLanguage: UiLanguage;
  uiFontFamily: string;
  settingsProfilePath: string;
}

interface FileAction {
  action: "create_file" | "replace_file" | "append_file" | "replace_selection" | "update";
  path?: string;
  content: string;
}

interface QuickPrompt {
  name: string;
  prompt: string;
}

interface CliToolCall {
  tool: CliToolName;
  args: Record<string, string | boolean | number>;
}

interface KnowledgeChunk {
  path: string;
  title: string;
  text: string;
  score: number;
}

interface SessionTurn {
  prompt: string;
  answer: string;
}

const DEFAULT_UI_FONT = `"JetBrains Mono", "SFMono-Regular", "Cascadia Code", Consolas, "Liberation Mono", monospace`;
const MODE_IDS: ChatMode[] = ["chat", "edit", "knowledge", "new"];
const DEFAULT_CUSTOM_PROVIDER_ID = "custom-1";
const PACKYAPI_BASE_URL = "https://www.packyapi.com/v1";

const UI_TEXT = {
  zh: {
    newChat: "新對話",
    history: "歷史",
    settings: "設定",
    command: "指令",
    context: "上下文",
    addContext: "加入上下文",
    send: "送出",
    selectModel: "選擇模型",
    folders: "資料夾",
    chooseFolders: "選擇資料夾",
    allVault: "全庫",
    localSearch: "本地搜尋",
    noContext: "未引用上下文",
    noActiveNoteContext: "未關聯當前頁面",
    noActiveNote: "未連接當前頁面",
    current: "當前",
    chatHistory: "歷史",
    error: "錯誤",
    quickPrompts: "快速提示詞",
    removeCurrentContext: "移除當前頁面上下文",
    removeHistoryContext: "移除歷史上下文",
    activeNoteFallback: "當前筆記",
    modeChat: "對話",
    modeEdit: "編輯",
    modeKnowledge: "搜尋",
    modeNew: "新建",
    descChat: "只引用上下文問答，不寫入文件",
    descEdit: "引用上下文並改寫整份當前 MD",
    descKnowledge: "搜尋資料夾與上下文後回答",
    descNew: "引用上下文並建立新的 MD",
    placeholderChat: "問點什麼...",
    placeholderEdit: "輸入修改要求...",
    placeholderKnowledge: "搜尋問題...",
    placeholderNew: "描述新筆記...",
    progressPreparing: "正在準備上下文...",
    progressEdit: "正在讓 AI 生成整份 MD 修改方案...",
    progressConfirmEdit: "正在等待你確認文件修改...",
    progressKnowledge: "正在搜尋資料夾與重排相關片段...",
    progressKnowledgeDone: "搜尋已完成。",
    progressNew: "正在讓 AI 規劃新 MD...",
    progressConfirmNew: "正在等待你確認新建文件...",
    progressChat: "正在請求模型回答...",
    progressChatDone: "回覆已完成。",
    progressFailed: "操作失敗，請查看錯誤訊息。",
    editDone: "已生成整份 MD 修改方案；如已開啟確認，請在確認視窗檢查後套用。",
    editNoActions: "AI 沒有返回可套用的修改方案。",
    newDone: "已生成新建 MD 方案；如已開啟確認，請在確認視窗檢查後套用。",
    newNoActions: "AI 沒有返回可新建的 MD。",
    fileActionDone: "已建立文件修改方案，請在確認窗口檢查並套用。",
    fileActionApplied: "已接收並套用文件操作。"
  },
  en: {
    newChat: "New chat",
    history: "History",
    settings: "Settings",
    command: "Command",
    context: "Context",
    addContext: "Add context",
    send: "Send",
    selectModel: "Select model",
    folders: "Folders",
    chooseFolders: "Choose folders",
    allVault: "All vault",
    localSearch: "Local search",
    noContext: "No context",
    noActiveNoteContext: "Current note detached",
    noActiveNote: "No current note",
    current: "Current",
    chatHistory: "History",
    error: "Error",
    quickPrompts: "Quick prompts",
    removeCurrentContext: "Remove current-note context",
    removeHistoryContext: "Remove history context",
    activeNoteFallback: "current note",
    modeChat: "Chat",
    modeEdit: "Edit",
    modeKnowledge: "Search",
    modeNew: "New",
    descChat: "Ask questions with context only; no file writes",
    descEdit: "Use context and rewrite the current MD",
    descKnowledge: "Search folders and context before answering",
    descNew: "Use context and create a new MD",
    placeholderChat: "Ask anything...",
    placeholderEdit: "Describe the edit...",
    placeholderKnowledge: "Search question...",
    placeholderNew: "Describe the new note...",
    progressPreparing: "Preparing context...",
    progressEdit: "Asking AI to generate a full-note edit plan...",
    progressConfirmEdit: "Waiting for your confirmation before editing...",
    progressKnowledge: "Searching folders and ranking relevant snippets...",
    progressKnowledgeDone: "Search completed.",
    progressNew: "Asking AI to plan the new MD...",
    progressConfirmNew: "Waiting for your confirmation before creating the file...",
    progressChat: "Requesting model response...",
    progressChatDone: "Response completed.",
    progressFailed: "Operation failed. Check the error message.",
    editDone: "Full-note edit plan generated. If confirmation is enabled, review and apply it in the confirmation modal.",
    editNoActions: "AI did not return an applicable edit plan.",
    newDone: "New MD plan generated. If confirmation is enabled, review and apply it in the confirmation modal.",
    newNoActions: "AI did not return a new MD action.",
    fileActionDone: "File edit plan generated. Review and apply it in the confirmation modal.",
    fileActionApplied: "File action received and applied."
  }
} as const;

const DEFAULT_SETTINGS: Settings = {
  provider: "deepseek",
  providers: {
    deepseek: {
      apiKey: "",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      models: "deepseek-v4-flash\ndeepseek-v4-pro",
      apiMode: "chat_completions"
    },
    custom: {
      apiKey: "",
      baseUrl: "",
      model: "",
      models: "",
      apiMode: "chat_completions"
    }
  },
  customProviders: [
    {
      id: DEFAULT_CUSTOM_PROVIDER_ID,
      name: "自定義接口 1",
      apiKey: "",
      baseUrl: "",
      model: "",
      models: "",
      apiMode: "chat_completions",
      omitSamplingParams: false
    }
  ],
  activeCustomProviderId: DEFAULT_CUSTOM_PROVIDER_ID,
  preferredChatMode: "chat",
  temperature: 0.2,
  topP: null,
  frequencyPenalty: null,
  maxTokens: 4000,
  systemPrompt: "You are a precise Markdown writing assistant inside Obsidian. If the user asks you to create, edit, append, rewrite, insert, delete, or update a Markdown note, you must use the plugin file-action workflow. Never claim that a file was modified unless the plugin has applied a file action.",
  quickPrompts: [
    { name: "總結", prompt: "Create a bullet-point summary of {}. Each bullet point should capture a key point. Return only the bullet-point summary." },
    { name: "修正文法", prompt: "Fix the grammar and spelling of {}. Preserve all formatting, line breaks, and special characters. Do not add or remove any content. Return only the corrected text." },
    { name: "翻譯（中轉英）", prompt: "Translate the following text into English suitable for the Hong Kong market. Preserve the meaning, tone, formatting, and structure. Return only the translated text:\n\n{}" },
    { name: "縮短", prompt: "Reduce {} to half its length while preserving the main ideas, essential details, and original tone. Return only the shortened text." }
  ],
  suggestedPrompts: "",
  chatHistory: [],
  enableMemory: true,
  memoryFilePath: "md-ai-writer/memory.md",
  agentTools: {
    vaultSearch: true,
    webSearch: false,
    writeFile: true,
    editFile: true,
    youtubeTranscription: false,
    obsidianCli: false
  },
  obsidianCliPath: "obsidian",
  obsidianCliVault: "",
  obsidianCliTimeoutMs: 20000,
  useJsonOutputForActions: true,
  sendDeepSeekThinkingOptions: true,
  deepSeekThinkingEnabled: false,
  reasoningEffort: "high",
  confirmBeforeApply: true,
  includeActiveNoteByDefault: true,
  knowledgeFolders: [],
  voyageApiKey: "",
  voyageRerankModel: "rerank-2.5-lite",
  knowledgeMaxCandidates: 60,
  knowledgeTopK: 8,
  uiLanguage: "zh",
  uiFontFamily: DEFAULT_UI_FONT,
  settingsProfilePath: DEFAULT_SETTINGS_PROFILE_PATH
};

const ACTION_SCHEMA = `Return only JSON with this shape:
{
  "actions": [
    {
      "action": "create_file | replace_file | append_file | replace_selection",
      "path": "relative/path.md, required except replace_selection",
      "content": "Markdown content"
    }
  ]
}
You may also return a single action as a fenced block:
\`\`\`file-action
{"action":"update","path":"relative/path.md","content":"full markdown"}
\`\`\`
Treat "update" as replace_file. For formatting or reorganizing a note, return the full updated Markdown content.
If the user is only asking a question or asking for text in chat, return {"actions":[]}.
If the user asks to modify the active note and no path is specified, use the active note path from <active_note>.
Only say a file was modified through an action; do not describe completed edits in plain text.
Do not wrap the JSON in Markdown fences.`;

const CLI_TOOL_SCHEMA = `You may use Obsidian CLI tools before answering.
Return only JSON with this shape:
{
  "toolCalls": [
    {
      "tool": "search | read | tasks | tags | unresolved | daily | files",
      "args": { "query": "text", "path": "note.md", "limit": 20 }
    }
  ],
  "answerWithoutTools": "Use this only if no CLI tool is needed."
}
Use at most 3 tool calls. Prefer read for a known note path, search for vault lookup, tasks for task queries, tags for tag overview, unresolved for unresolved links, daily for daily note, and files for recent/list operations.`;

export default class MdAiWriterPlugin extends Plugin {
  settings: Settings;
  lastMarkdownLeaf: WorkspaceLeaf | null = null;

  async onload() {
    await this.loadSettings();
    this.applyGlobalUiPreferences();
    this.rememberMarkdownLeaf(this.app.workspace.activeLeaf);

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.rememberMarkdownLeaf(leaf);
      })
    );

    this.registerView(VIEW_TYPE, (leaf) => new AiWriterView(leaf, this));

    this.addRibbonIcon("sparkles", `Open ${APP_NAME}`, () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-md-ai-writer",
      name: "打開 AI 對話",
      callback: () => void this.activateView()
    });

    this.addCommand({
      id: "insert-ai-answer",
      name: "AI 回答並插入到游標",
      editorCallback: (editor) => {
        new PromptModal(this.app, "詢問 AI", "希望 AI 寫什麼？", async (prompt) => {
          const context = await this.getActiveContext();
          const answer = await this.completeText(prompt, context);
          editor.replaceSelection(answer);
        }).open();
      }
    });

    this.addCommand({
      id: "rewrite-selection",
      name: "AI 重寫選中文字",
      editorCallback: (editor) => {
        const selection = editor.getSelection();
        if (!selection.trim()) {
          new Notice("請先選中文字。");
          return;
        }
        new PromptModal(this.app, "重寫選中文字", "希望怎樣修改選中文字？", async (prompt) => {
          const answer = await this.completeText(`${prompt}\n\nSelected text:\n${selection}`, "");
          editor.replaceSelection(answer);
        }).open();
      }
    });

    this.addSettingTab(new MdAiWriterSettingTab(this.app, this));
  }

  onunload() {
    document.body.style.removeProperty("--md-ai-writer-font");
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf?.setViewState({ type: VIEW_TYPE, active: true });
    if (leaf) this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings() {
    this.syncLegacyCustomProvider();
    await this.saveData(this.settings);
    this.applyGlobalUiPreferences();
  }

  async exportSettingsProfile(path = this.settings.settingsProfilePath) {
    this.syncLegacyCustomProvider();
    const normalized = normalizeMarkdownPath(path || DEFAULT_SETTINGS_PROFILE_PATH);
    const markdown = buildSettingsProfileMarkdown(this.settings);
    await this.createOrReplaceFile(normalized, markdown, false);
    this.settings.settingsProfilePath = normalized;
    await this.saveSettings();
  }

  async importSettingsProfile(path = this.settings.settingsProfilePath) {
    const normalized = normalizeMarkdownPath(path || DEFAULT_SETTINGS_PROFILE_PATH);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) throw new Error(`找不到設定檔：${normalized}`);
    const markdown = await this.app.vault.read(file);
    const imported = parseSettingsProfileMarkdown(markdown);
    this.settings = normalizeSettings({
      ...this.settings,
      ...imported,
      settingsProfilePath: normalized
    });
    await this.saveSettings();
    this.refreshOpenViews();
  }

  applyGlobalUiPreferences() {
    document.body.style.setProperty("--md-ai-writer-font", this.settings.uiFontFamily.trim() || DEFAULT_UI_FONT);
  }

  refreshOpenViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof AiWriterView) leaf.view.refreshUiChrome();
    }
  }

  rememberMarkdownLeaf(leaf: WorkspaceLeaf | null) {
    if (leaf?.view instanceof MarkdownView) {
      this.lastMarkdownLeaf = leaf;
    }
  }

  getActiveMarkdownView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;
    const fallback = this.lastMarkdownLeaf?.view;
    return fallback instanceof MarkdownView ? fallback : null;
  }

  syncLegacyCustomProvider() {
    const active = this.getActiveCustomProvider();
    this.settings.providers.custom = stripCustomProvider(active);
  }

  getCustomProviders(): CustomProviderConfig[] {
    if (!this.settings.customProviders?.length) {
      this.settings.customProviders = [
        createCustomProviderConfig(this.settings.providers.custom, DEFAULT_CUSTOM_PROVIDER_ID, "自定義接口 1")
      ];
    }
    return this.settings.customProviders;
  }

  getActiveCustomProvider(): CustomProviderConfig {
    const providers = this.getCustomProviders();
    const active = providers.find((provider) => provider.id === this.settings.activeCustomProviderId) ?? providers[0];
    this.settings.activeCustomProviderId = active.id;
    return active;
  }

  getCustomProviderConfig(customId?: string): CustomProviderConfig {
    const providers = this.getCustomProviders();
    const found = customId ? providers.find((provider) => provider.id === customId) : undefined;
    return found ?? this.getActiveCustomProvider();
  }

  getProviderConfig(provider: ProviderId = this.settings.provider, customId?: string): ProviderConfig {
    return provider === "custom" ? this.getCustomProviderConfig(customId) : this.settings.providers.deepseek;
  }

  getProviderDisplayName(provider: ProviderId = this.settings.provider, customId?: string): string {
    if (provider === "deepseek") return "DeepSeek";
    return this.getCustomProviderConfig(customId).name || "自定義接口";
  }

  getModelOptions(provider: ProviderId = this.settings.provider, customId?: string): string[] {
    const config = this.getProviderConfig(provider, customId);
    const configured = config.models
      .split(/[\n,]/)
      .map((model) => model.trim())
      .filter(Boolean);
    if (config.model && !configured.includes(config.model)) configured.unshift(config.model);
    return configured;
  }

  getQuickPrompts(): QuickPrompt[] {
    if (this.settings.quickPrompts?.length) return this.settings.quickPrompts;
    return parseSuggestedPrompts(this.settings.suggestedPrompts).map((prompt) => ({ name: prompt.title, prompt: prompt.body }));
  }

  async completeText(prompt: string, context: string): Promise<string> {
    const messages: ChatMessage[] = [
      { role: "system", content: `${this.settings.systemPrompt}\n\nIf the user asks to modify/create/write a Markdown file, do not claim success in chat. Ask the plugin to use file actions instead.` },
      { role: "user", content: context ? `${context}\n\nUser request:\n${prompt}` : prompt }
    ];
    return this.requestChat(messages, false);
  }

  async completeChatOnly(prompt: string, context: string): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          `${this.settings.systemPrompt}\n\n` +
          "You are in Chat mode. Use the provided context only for discussion and Q&A. " +
          "Do not create, modify, append, or delete files. If the user asks for file changes, explain the proposed change and tell them to switch to Edit or New mode."
      },
      { role: "user", content: context ? `${context}\n\nUser request:\n${prompt}` : prompt }
    ];
    return this.requestChat(messages, false);
  }

  async getActiveNoteFullContext(): Promise<{ file: TFile; context: string }> {
    const view = this.getActiveMarkdownView();
    const file = view?.file;
    if (!file) throw new Error("Edit 模式需要先打開一份 Markdown。");
    const body = await this.app.vault.read(file);
    return {
      file,
      context: `<active_note path="${file.path}" mode="full active note">\n${body}\n</active_note>`
    };
  }

  async planEditCurrentNote(prompt: string): Promise<FileAction[]> {
    if (!this.settings.agentTools.editFile || !this.settings.agentTools.writeFile) {
      throw new Error("Edit 模式需要啟用 Agent 工具中的 Edit File 和 Write to File。");
    }
    const { file, context } = await this.getActiveNoteFullContext();
    const request =
      `You are in Edit mode. Rewrite the whole active Markdown note at path "${file.path}". ` +
      `Return exactly one update action with path "${file.path}" and the full updated Markdown content. ` +
      `Keep the user's intent and preserve useful existing content unless the request says otherwise.\n\nUser request:\n${prompt}`;
    return this.planFileActions(request, context);
  }

  async planNewNote(prompt: string, context: string): Promise<FileAction[]> {
    if (!this.settings.agentTools.writeFile) throw new Error("New 模式需要啟用 Agent 工具中的 Write to File。");
    const request =
      "You are in New mode. Create a new Markdown note in the vault. " +
      "Return one or more create_file actions. If the user provides a target path, use it. " +
      'If no target path is provided, choose a concise Traditional Chinese title and put the note under "AI Notes/". ' +
      "Do not overwrite existing files. Use the provided context as source material when relevant.\n\n" +
      `User request:\n${prompt}`;
    const actions = await this.planFileActions(request, context);
    return actions.map((action) =>
      action.action === "replace_file" || action.action === "update"
        ? { ...action, action: "create_file" as const }
        : action
    );
  }

  async answerWithKnowledgeSearch(prompt: string, context: string, folders: string[]): Promise<string> {
    const searchQuery = buildKnowledgeSearchQuery(prompt, context);
    const result = await this.searchKnowledge(searchQuery, folders);
    if (!result.chunks.length) {
      const fallback = await this.completeChatOnly(
        `${prompt}\n\nNo matching Markdown snippets were found in the selected knowledge folders. Answer only from the attached context if possible.`,
        context
      );
      return `${fallback}\n\n搜尋結果：未找到可引用的資料夾片段。`;
    }

    const snippets = result.chunks.map((chunk, index) => {
      return `[S${index + 1}] ${chunk.path}${chunk.title ? ` - ${chunk.title}` : ""}\n${chunk.text}`;
    }).join("\n\n---\n\n");

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          `${this.settings.systemPrompt}\n\n` +
          "You are in Search mode. Answer using the provided knowledge snippets and attached context. " +
          "Cite source snippets with [S1], [S2] when they support the answer. If the snippets do not support a claim, say so. Write Traditional Chinese unless the user asks otherwise."
      },
      {
        role: "user",
        content:
          `${context ? `${context}\n\n` : ""}` +
          `Knowledge snippets (${result.method}; search query: ${searchQuery}):\n${snippets}\n\n` +
          `User request:\n${prompt}`
      }
    ];
    const answer = await this.requestChat(messages, false);
    const sourceList = result.chunks
      .map((chunk, index) => `- [S${index + 1}] ${chunk.path}${chunk.title ? ` - ${chunk.title}` : ""}`)
      .join("\n");
    return `${answer}\n\n來源片段：\n${sourceList}`;
  }

  async searchKnowledge(prompt: string, folders: string[]): Promise<{ chunks: KnowledgeChunk[]; method: string }> {
    const files = this.getKnowledgeFiles(folders);
    const allChunks: KnowledgeChunk[] = [];
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      allChunks.push(...chunkMarkdown(file.path, content));
    }

    const maxCandidates = clampNumber(this.settings.knowledgeMaxCandidates, 10, 200, DEFAULT_SETTINGS.knowledgeMaxCandidates);
    const topK = clampNumber(this.settings.knowledgeTopK, 1, 20, DEFAULT_SETTINGS.knowledgeTopK);
    const candidates = takeDiverseKnowledgeChunks(rankKnowledgeChunks(prompt, allChunks), maxCandidates, 2);
    if (!candidates.length) return { chunks: [], method: "local lexical search" };

    if (this.settings.voyageApiKey.trim()) {
      try {
        const reranked = await this.rerankWithVoyage(prompt, candidates, topK);
        if (reranked.length) return { chunks: reranked, method: `Voyage rerank (${this.settings.voyageRerankModel || DEFAULT_SETTINGS.voyageRerankModel})` };
      } catch (error) {
        console.warn(`${APP_NAME} Voyage rerank failed, falling back to local search`, error);
      }
    }

    return { chunks: candidates.slice(0, topK), method: "local lexical search" };
  }

  async rerankWithVoyage(query: string, chunks: KnowledgeChunk[], topK: number): Promise<KnowledgeChunk[]> {
    const documents = chunks.map((chunk) => `${chunk.path}${chunk.title ? ` - ${chunk.title}` : ""}\n${chunk.text}`);
    const response = await requestUrl({
      url: "https://api.voyageai.com/v1/rerank",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.voyageApiKey.trim()}`
      },
      body: JSON.stringify({
        model: this.settings.voyageRerankModel.trim() || DEFAULT_SETTINGS.voyageRerankModel,
        query,
        documents,
        top_k: topK,
        return_documents: false
      })
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Voyage rerank failed: HTTP ${response.status} ${response.text}`);
    }

    const json = response.json as { data?: Array<{ index?: number; relevance_score?: number; relevanceScore?: number }>; results?: Array<{ index?: number; relevance_score?: number; relevanceScore?: number }> };
    const rows = json.data ?? json.results ?? [];
    return rows
      .map((row) => {
        const index = typeof row.index === "number" ? row.index : -1;
        const base = chunks[index];
        if (!base) return null;
        return {
          ...base,
          score: Number(row.relevance_score ?? row.relevanceScore ?? base.score)
        };
      })
      .filter((chunk): chunk is KnowledgeChunk => chunk !== null);
  }

  getVaultFolders(): string[] {
    return this.app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder)
      .map((folder) => folder.path)
      .filter((path) => path && !path.startsWith(".obsidian"))
      .sort((a, b) => a.localeCompare(b));
  }

  getKnowledgeFiles(folders: string[]): TFile[] {
    const selected = folders.map((folder) => normalizePath(folder)).filter(Boolean);
    return this.app.vault.getMarkdownFiles().filter((file) => {
      if (file.path.startsWith(".obsidian/")) return false;
      if (isKnowledgeNoisePath(file.path)) return false;
      if (!selected.length) return true;
      return selected.some((folder) => file.path.startsWith(`${folder}/`));
    });
  }

  async completeWithCliAgent(prompt: string, context: string): Promise<string> {
    if (!this.settings.agentTools.obsidianCli) {
      return this.completeText(prompt, context);
    }

    const planMessages: ChatMessage[] = [
      { role: "system", content: `${this.settings.systemPrompt}\n\n${CLI_TOOL_SCHEMA}` },
      { role: "user", content: context ? `${context}\n\nUser request:\n${prompt}` : prompt }
    ];
    const planRaw = await this.requestChat(planMessages, true);
    const plan = parseCliPlan(planRaw);
    if (!plan.toolCalls.length && plan.answerWithoutTools) return plan.answerWithoutTools;

    const outputs: string[] = [];
    for (const call of plan.toolCalls.slice(0, 3)) {
      const output = await this.runObsidianCliTool(call);
      outputs.push(`Tool: ${call.tool}\nArgs: ${JSON.stringify(call.args)}\nOutput:\n${output}`);
    }

    const finalMessages: ChatMessage[] = [
      { role: "system", content: this.settings.systemPrompt },
      {
        role: "user",
        content: `${context ? `${context}\n\n` : ""}User request:\n${prompt}\n\nObsidian CLI results:\n${outputs.join("\n\n---\n\n")}\n\nAnswer the user using the CLI results.`
      }
    ];
    return this.requestChat(finalMessages, false);
  }

  async planFileActions(prompt: string, context: string): Promise<FileAction[]> {
    const messages: ChatMessage[] = [
      { role: "system", content: `${this.settings.systemPrompt}\n\n${ACTION_SCHEMA}` },
      { role: "user", content: context ? `${context}\n\nUser request:\n${prompt}` : prompt }
    ];
    const response = await this.requestChat(messages, this.settings.useJsonOutputForActions);
    return parseActions(response);
  }

  async tryHandleFileActionFromChat(prompt: string, context: string): Promise<boolean> {
    if (!looksLikeFileAction(prompt)) return false;
    const actions = await this.planFileActions(prompt, context);
    if (!actions.length) return false;
    await this.applyActions(actions);
    return true;
  }

  async tryApplyFileActionText(text: string): Promise<boolean> {
    const actions = parseActions(text);
    if (!actions.length) return false;
    await this.applyActions(actions);
    return true;
  }

  async requestChat(messages: ChatMessage[], jsonOutput: boolean): Promise<string> {
    const config = this.getProviderConfig();
    if (!config.apiKey.trim()) {
      throw new Error("缺少 API Key，請先到插件設定中填寫。");
    }
    if (!config.baseUrl.trim()) {
      throw new Error("缺少 Base URL，請先到插件設定中填寫。");
    }
    if (!config.model.trim()) {
      throw new Error("缺少模型，請先在對話框或插件設定中選擇。");
    }

    const apiMode = effectiveProviderApiMode(config);
    const useResponsesApi = apiMode === "responses";
    const requestMessages = jsonOutput && !useResponsesApi ? ensureJsonModeUserPrompt(messages) : messages;
    const body: Record<string, unknown> = useResponsesApi ? responsesRequestBody(requestMessages, config.model.trim(), this.settings.maxTokens) : {
      model: config.model.trim(),
      messages: requestMessages,
      max_tokens: this.settings.maxTokens,
      stream: false
    };

    if (jsonOutput && !useResponsesApi) {
      body.response_format = { type: "json_object" };
    }

    if (!useResponsesApi && this.settings.provider === "deepseek" && this.settings.sendDeepSeekThinkingOptions) {
      body.thinking = { type: this.settings.deepSeekThinkingEnabled ? "enabled" : "disabled" };
      if (this.settings.deepSeekThinkingEnabled) {
        body.reasoning_effort = this.settings.reasoningEffort;
      } else {
        body.temperature = this.settings.temperature;
        if (this.settings.topP !== null) body.top_p = this.settings.topP;
        if (this.settings.frequencyPenalty !== null) body.frequency_penalty = this.settings.frequencyPenalty;
      }
    } else if (!useResponsesApi && shouldSendSamplingOptions(config)) {
      body.temperature = this.settings.temperature;
      if (this.settings.topP !== null) body.top_p = this.settings.topP;
      if (this.settings.frequencyPenalty !== null) body.frequency_penalty = this.settings.frequencyPenalty;
    }

    const url = providerRequestUrl(config);
    const response = await requestUrl({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey.trim()}`
      },
      body: JSON.stringify(body),
      throw: false
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`AI request failed: HTTP ${response.status} ${response.text}`);
    }

    const json = parseAiJsonResponse(response.text, url);
    const content = useResponsesApi ? extractResponsesContent(json) : extractChatCompletionsContent(json);
    if (!content) {
      throw new Error(`AI response did not include message content.\nRequest URL: ${url}\nAPI mode: ${apiMode}\n${summarizeAiResponse(json)}`);
    }
    return content.trim();
  }

  async testProviderConnection(provider: ProviderId, customId?: string): Promise<string> {
    const previous = this.settings.provider;
    const previousCustomId = this.settings.activeCustomProviderId;
    this.settings.provider = provider;
    if (provider === "custom" && customId) this.settings.activeCustomProviderId = customId;
    try {
      const answer = await this.requestChat(
        [
          { role: "system", content: "Reply with exactly: ok" },
          { role: "user", content: "connection test" }
        ],
        false
      );
      const config = this.getProviderConfig();
      return `OK\nURL: ${providerRequestUrl(config)}\nConfigured mode: ${config.apiMode}\nEffective mode: ${effectiveProviderApiMode(config)}\nModel: ${config.model}\nResponse: ${answer}`;
    } finally {
      this.settings.provider = previous;
      this.settings.activeCustomProviderId = previousCustomId;
    }
  }

  async runObsidianCliTool(call: CliToolCall): Promise<string> {
    if (!this.settings.agentTools.obsidianCli) throw new Error("Obsidian CLI 工具未啟用。");
    if (!isAllowedCliTool(call.tool)) throw new Error(`不允許的 Obsidian CLI 工具：${call.tool}`);
    const args = this.buildObsidianCliArgs(call);
    return execFileText(this.settings.obsidianCliPath || "obsidian", args, this.settings.obsidianCliTimeoutMs);
  }

  buildObsidianCliArgs(call: CliToolCall): string[] {
    const args: string[] = [call.tool];
    const safeArgs = sanitizeCliArgs(call.args);
    if (this.settings.obsidianCliVault.trim()) {
      safeArgs.vault = this.settings.obsidianCliVault.trim();
    }
    for (const [key, value] of Object.entries(safeArgs)) {
      if (value === true) args.push(key);
      else if (value !== false && value !== "") args.push(`${key}=${String(value)}`);
    }
    return args;
  }

  async getActiveContext(): Promise<string> {
    if (!this.settings.includeActiveNoteByDefault) return "";
    const view = this.getActiveMarkdownView();
    const file = view?.file;
    if (!file) return "";
    const selection = view.editor.getSelection();
    const body = selection.trim() ? selection : await this.app.vault.read(file);
    const mode = selection.trim() ? "selected text from active note" : "full active note";
    return `<active_note path="${file.path}" mode="${mode}">\n${body}\n</active_note>`;
  }

  async editActiveNote(prompt: string) {
    if (!this.settings.agentTools.editFile) throw new Error("Edit File 工具未啟用，請到設定 > Agent 工具開啟。");
    const view = this.getActiveMarkdownView();
    const file = view?.file;
    if (!file) throw new Error("找不到當前 Markdown 文件。");
    const selection = view.editor.getSelection();
    const request = selection.trim()
      ? `Modify the selected text in the active note. Return exactly one replace_selection action unless the user explicitly asks for a whole-file rewrite.\nActive note path: ${file.path}\nUser request: ${prompt}`
      : `Modify the current active Markdown note. Return exactly one replace_file action with path "${file.path}" and the full updated Markdown content.\nUser request: ${prompt}`;
    const actions = await this.planFileActions(request, await this.getActiveContext());
    await this.applyActions(actions);
  }

  async applyActions(actions: FileAction[]) {
    if (!actions.length) {
      new Notice("AI 沒有返回文件操作。");
      return;
    }

    if (this.settings.confirmBeforeApply) {
      new ConfirmActionsModal(this.app, actions, async () => {
        await this.runActions(actions);
      }).open();
      return;
    }

    await this.runActions(actions);
  }

  async runActions(actions: FileAction[]) {
    for (const action of actions) {
      if (action.action === "replace_selection") {
        if (!this.settings.agentTools.editFile) throw new Error("Edit File 工具未啟用。");
        const view = this.getActiveMarkdownView();
        if (!view) throw new Error("找不到可修改的 Markdown 編輯器。");
        view.editor.replaceSelection(action.content);
        continue;
      }

      if (!action.path) throw new Error(`${action.action} requires a path.`);
      if ((action.action === "create_file" || action.action === "replace_file" || action.action === "append_file" || action.action === "update") && !this.settings.agentTools.writeFile) {
        throw new Error("Write to File 工具未啟用。");
      }
      if (action.action === "create_file") await this.createOrReplaceFile(action.path, action.content, true);
      if (action.action === "replace_file" || action.action === "update") await this.createOrReplaceFile(action.path, action.content, false);
      if (action.action === "append_file") await this.appendFile(action.path, action.content);
    }
    new Notice(`已套用 ${actions.length} 個 AI 操作。`);
  }

  async rememberPrompt(prompt: string) {
    const title = prompt.split("\n")[0].trim().slice(0, 60) || "Untitled chat";
    this.settings.chatHistory = [
      { title, prompt, createdAt: Date.now() },
      ...this.settings.chatHistory.filter((item) => item.prompt !== prompt)
    ].slice(0, 50);
    await this.saveSettings();
  }

  async rememberAssistantAnswer(prompt: string, answer: string) {
    const item = this.settings.chatHistory.find((entry) => entry.prompt === prompt);
    if (!item) return;
    item.answer = answer.slice(0, 16000);
    await this.saveSettings();
  }

  formatHistoryContext(item: ChatHistoryItem): string {
    const time = formatMemoryTime(new Date(item.createdAt));
    return `<chat_history title="${escapeXmlAttr(item.title)}" time="${time}">
User:
${item.prompt}

Assistant:
${item.answer?.trim() || "(No assistant answer saved for this older record.)"}
</chat_history>`;
  }

  async writeMemorySummary(userPrompt: string, assistantAnswer: string) {
    if (!this.settings.enableMemory) return;
    if (!this.settings.memoryFilePath.trim()) return;

    try {
      const summaryPrompt = `Create a concise memory entry for this Obsidian AI chat.
Return only JSON: {"title":"short title","summary":"one paragraph summary"}.

User:
${userPrompt}

Assistant:
${assistantAnswer}`;
      const raw = await this.requestChat(
        [
          { role: "system", content: "You summarize conversations into durable memory entries. Keep it factual and concise. Write Traditional Chinese unless the conversation is clearly in another language." },
          { role: "user", content: summaryPrompt }
        ],
        true
      );
      const parsed = JSON.parse(stripJsonFence(raw)) as { title?: string; summary?: string };
      const title = sanitizeMemoryText(parsed.title || userPrompt.split("\n")[0] || "未命名對話");
      const summary = sanitizeMemoryText(parsed.summary || assistantAnswer);
      const entry = `## ${title}\n**Time:** ${formatMemoryTime(new Date())}\n**Summary:** ${summary}\n`;
      await this.appendFile(this.settings.memoryFilePath, entry);
    } catch (error) {
      console.warn(`${APP_NAME} memory write failed`, error);
    }
  }

  async createOrReplaceFile(path: string, content: string, failIfExists: boolean) {
    const normalized = normalizeMarkdownPath(path);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) {
      if (failIfExists) throw new Error(`文件已存在：${normalized}`);
      await this.app.vault.process(existing, () => content);
      return;
    }
    await ensureFolder(this.app, normalized);
    await this.app.vault.create(normalized, content);
  }

  async appendFile(path: string, content: string) {
    const normalized = normalizeMarkdownPath(path);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) {
      await this.app.vault.process(existing, (current) => `${current}${current.endsWith("\n") ? "" : "\n\n"}${content}`);
      return;
    }
    await ensureFolder(this.app, normalized);
    await this.app.vault.create(normalized, content);
  }
}

class AiWriterView extends ItemView {
  plugin: MdAiWriterPlugin;
  logEl: HTMLElement;
  inputEl: HTMLTextAreaElement;
  contextChip: HTMLElement;
  modelButton: HTMLButtonElement;
  suggestedEl: HTMLElement;
  modeSelector: HTMLElement;
  subtitleEl: HTMLElement;
  knowledgePanel: HTMLElement;
  knowledgeSummaryEl: HTMLElement;
  commandLabelEl: HTMLElement;
  contextLabelEl: HTMLElement;
  sendButton: HTMLButtonElement;
  useActiveNoteContext = true;
  historyContextItems: ChatHistoryItem[] = [];
  sessionTurns: SessionTurn[] = [];
  mode: ChatMode;

  constructor(leaf: WorkspaceLeaf, plugin: MdAiWriterPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.mode = plugin.settings.preferredChatMode;
    this.useActiveNoteContext = plugin.settings.includeActiveNoteByDefault;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return APP_NAME;
  }

  async onOpen() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("md-ai-writer-view");
    this.applyFontPreference(root);

    this.suggestedEl = root.createDiv({ cls: "md-ai-writer-prompt-strip" });
    this.suggestedEl.hide();

    this.logEl = root.createDiv({ cls: "md-ai-writer-log" });

    const composer = root.createDiv({ cls: "md-ai-writer-command-panel" });
    const composerHeader = composer.createDiv({ cls: "md-ai-writer-command-header" });
    const composerTitle = composerHeader.createDiv({ cls: "md-ai-writer-command-title" });
    composerTitle.createEl("strong", { text: APP_NAME });
    this.subtitleEl = composerTitle.createDiv({ cls: "md-ai-writer-subtitle" });
    this.commandLabelEl = composerHeader.createSpan({ text: uiText(this.plugin.settings, "command") });
    const composerTools = composerHeader.createDiv({ cls: "md-ai-writer-send-actions" });
    composerTools.createEl("button", { cls: "md-ai-writer-slash-button", text: "/", attr: { title: uiText(this.plugin.settings, "quickPrompts") } }).onclick = () => this.showPromptMenu();
    this.iconButton(composerTools, "plus", uiText(this.plugin.settings, "newChat"), () => this.clearChat());
    this.iconButton(composerTools, "history", uiText(this.plugin.settings, "history"), () => new ChatHistoryModal(this.app, this.plugin, (prompt) => this.usePrompt(prompt)).open());
    this.iconButton(composerTools, "sliders-horizontal", uiText(this.plugin.settings, "settings"), () => new ChatSettingsModal(this.app, this.plugin, () => this.refreshModelButton()).open());

    this.modeSelector = composer.createDiv({ cls: "md-ai-writer-mode-selector md-ai-writer-mode-selector-inline" });
    this.renderModeSelector();

    this.knowledgePanel = composer.createDiv({ cls: "md-ai-writer-knowledge-panel md-ai-writer-knowledge-panel-inline" });
    this.renderKnowledgePanel();

    const composerContextRow = composer.createDiv({ cls: "md-ai-writer-context-row md-ai-writer-context-row-inline" });
    this.contextLabelEl = composerContextRow.createSpan({ cls: "md-ai-writer-section-label", text: uiText(this.plugin.settings, "context") });
    this.iconButton(composerContextRow, "at-sign", uiText(this.plugin.settings, "addContext"), () => {
      new ContextPickerModal(this.app, this.plugin, (selection) => this.useContextSelection(selection)).open();
      this.refreshContextLabel();
    });
    this.contextChip = composerContextRow.createDiv({ cls: "md-ai-writer-context-chips" });
    this.refreshContextLabel();

    this.inputEl = composer.createEl("textarea", {
      cls: "md-ai-writer-input",
      attr: { placeholder: this.placeholderForMode() }
    });
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.ask();
      }
      if (event.key === "/" && this.inputEl.value.trim() === "") {
        window.setTimeout(() => this.showPromptMenu(), 0);
      }
    });

    const bottom = composer.createDiv({ cls: "md-ai-writer-composer-bottom" });
    this.modelButton = bottom.createEl("button", { cls: "md-ai-writer-model-button" });
    this.modelButton.onclick = () => new ModelPickerModal(this.app, this.plugin, () => this.refreshModelButton()).open();
    this.refreshModelButton();
    this.sendButton = bottom.createEl("button", { cls: "md-ai-writer-send-button", attr: { title: uiText(this.plugin.settings, "send"), "aria-label": uiText(this.plugin.settings, "send") } });
    setIcon(this.sendButton, "send-horizontal");
    this.sendButton.onclick = () => void this.ask();
    this.registerInterval(window.setInterval(() => this.refreshContextLabel(), 1000));
    this.refreshModeUi();

  }

  applyFontPreference(root = this.containerEl.children[1] as HTMLElement) {
    root.style.setProperty("--md-ai-writer-font", this.plugin.settings.uiFontFamily.trim() || DEFAULT_UI_FONT);
  }

  refreshUiChrome() {
    this.applyFontPreference();
    if (this.commandLabelEl) this.commandLabelEl.setText(uiText(this.plugin.settings, "command"));
    if (this.contextLabelEl) this.contextLabelEl.setText(uiText(this.plugin.settings, "context"));
    if (this.sendButton) {
      this.sendButton.empty();
      setIcon(this.sendButton, "send-horizontal");
      this.sendButton.title = uiText(this.plugin.settings, "send");
      this.sendButton.ariaLabel = uiText(this.plugin.settings, "send");
    }
    if (this.modeSelector) this.renderModeSelector();
    if (this.knowledgePanel) this.renderKnowledgePanel();
    this.refreshModeUi();
    this.refreshContextLabel();
    this.refreshModelButton();
  }

  iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "md-ai-writer-icon-button", attr: { "aria-label": label, title: label } });
    setIcon(button, icon);
    button.onclick = onClick;
    return button;
  }

  addLog(role: string, content: string) {
    this.suggestedEl.hide();
    const item = this.logEl.createDiv({ cls: `md-ai-writer-message md-ai-writer-${role}` });
    if (role === "error") item.createDiv({ cls: "md-ai-writer-message-status", text: uiText(this.plugin.settings, "error") });
    item.createEl("pre", { text: content });
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  clearChat() {
    this.logEl.empty();
    this.suggestedEl.hide();
    this.sessionTurns = [];
  }

  renderModeSelector() {
    this.modeSelector.empty();
    for (const modeId of MODE_IDS) {
      const button = this.modeSelector.createEl("button", {
        cls: "md-ai-writer-mode-option",
        attr: { title: modeDescription(this.plugin.settings, modeId), "aria-label": modeLabel(this.plugin.settings, modeId) }
      });
      setIcon(button, modeIcon(modeId));
      button.dataset.mode = modeId;
      button.onclick = () => void this.setMode(modeId);
    }
  }

  async setMode(mode: ChatMode) {
    this.mode = mode;
    this.plugin.settings.preferredChatMode = mode;
    await this.plugin.saveSettings();
    this.refreshModeUi();
    this.refreshModelButton();
  }

  refreshModeUi() {
    if (this.subtitleEl) this.subtitleEl.setText("");
    if (this.modeSelector) {
      for (const button of Array.from(this.modeSelector.querySelectorAll("button"))) {
        button.toggleClass("is-active", button.dataset.mode === this.mode);
      }
    }
    if (this.inputEl) this.inputEl.placeholder = this.placeholderForMode();
    if (this.knowledgePanel) {
      if (this.mode === "knowledge") this.knowledgePanel.show();
      else this.knowledgePanel.hide();
    }
    this.refreshKnowledgeSummary();
  }

  placeholderForMode(): string {
    if (this.mode === "edit") return uiText(this.plugin.settings, "placeholderEdit");
    if (this.mode === "knowledge") return uiText(this.plugin.settings, "placeholderKnowledge");
    if (this.mode === "new") return uiText(this.plugin.settings, "placeholderNew");
    return uiText(this.plugin.settings, "placeholderChat");
  }

  renderKnowledgePanel() {
    this.knowledgePanel.empty();
    const top = this.knowledgePanel.createDiv({ cls: "md-ai-writer-knowledge-top" });
    const searchIcon = top.createSpan({ cls: "md-ai-writer-knowledge-icon", attr: { title: knowledgeModeTitle(this.plugin.settings) } });
    setIcon(searchIcon, "search");
    this.knowledgeSummaryEl = top.createDiv({ cls: "md-ai-writer-knowledge-summary" });
    const choose = top.createEl("button", {
      cls: "md-ai-writer-knowledge-button",
      attr: { title: uiText(this.plugin.settings, "chooseFolders"), "aria-label": uiText(this.plugin.settings, "chooseFolders") }
    });
    setIcon(choose, "folder-search");
    choose.onclick = () => {
      new KnowledgeFolderModal(this.app, this.plugin, async (folders) => {
        this.plugin.settings.knowledgeFolders = folders;
        await this.plugin.saveSettings();
        this.refreshKnowledgeSummary();
      }).open();
    };
    this.refreshKnowledgeSummary();
  }

  refreshKnowledgeSummary() {
    if (!this.knowledgeSummaryEl) return;
    const folders = this.plugin.settings.knowledgeFolders;
    this.knowledgeSummaryEl.setText(knowledgeSummaryText(this.plugin.settings, folders, Boolean(this.plugin.settings.voyageApiKey.trim())));
  }

  refreshModelButton() {
    const config = this.plugin.getProviderConfig();
    const model = config.model || uiText(this.plugin.settings, "selectModel");
    this.modelButton.setText(shortModelName(model));
    this.modelButton.title = model;
  }

  refreshContextLabel() {
    if (this.contextChip?.hasClass("md-ai-writer-context-chips")) {
      this.renderContextChips();
      return;
    }
    const view = this.plugin.getActiveMarkdownView();
    this.contextChip.empty();
    if (!this.useActiveNoteContext) {
      this.contextChip.setText(uiText(this.plugin.settings, "noActiveNoteContext"));
      this.contextChip.addClass("is-empty");
      return;
    }
    if (!view?.file) {
      this.contextChip.setText(uiText(this.plugin.settings, "noActiveNote"));
      this.contextChip.addClass("is-empty");
      return;
    }
    this.contextChip.removeClass("is-empty");
    setIcon(this.contextChip.createSpan(), "file-text");
    this.contextChip.createSpan({ text: ` ${view.file.basename} ` });
    const remove = this.contextChip.createEl("button", { cls: "md-ai-writer-chip-remove", text: "x", attr: { title: uiText(this.plugin.settings, "removeCurrentContext") } });
    remove.onclick = (event) => {
      event.stopPropagation();
      this.useActiveNoteContext = false;
      this.refreshContextLabel();
    };
  }

  renderContextChips() {
    const view = this.plugin.getActiveMarkdownView();
    this.contextChip.empty();
    let count = 0;

    if (this.useActiveNoteContext && view?.file) {
      count++;
      const chip = this.contextChip.createDiv({ cls: "md-ai-writer-context-chip" });
      setIcon(chip.createSpan(), "file-text");
      chip.createSpan({ text: ` ${view.file.basename} ` });
      const remove = chip.createEl("button", { cls: "md-ai-writer-chip-remove", text: "x", attr: { title: uiText(this.plugin.settings, "removeCurrentContext") } });
      remove.onclick = (event) => {
        event.stopPropagation();
        this.useActiveNoteContext = false;
        this.refreshContextLabel();
      };
    }

    for (const item of this.historyContextItems) {
      count++;
      const chip = this.contextChip.createDiv({ cls: "md-ai-writer-context-chip" });
      setIcon(chip.createSpan(), "messages-square");
      chip.createSpan({ text: ` ${item.title || uiText(this.plugin.settings, "chatHistory")} ` });
      const remove = chip.createEl("button", { cls: "md-ai-writer-chip-remove", text: "x", attr: { title: uiText(this.plugin.settings, "removeHistoryContext") } });
      remove.onclick = (event) => {
        event.stopPropagation();
        this.historyContextItems = this.historyContextItems.filter((entry) => entry.createdAt !== item.createdAt);
        this.refreshContextLabel();
      };
    }

    if (!count) {
      const chip = this.contextChip.createDiv({ cls: "md-ai-writer-context-chip is-empty" });
      chip.setText(uiText(this.plugin.settings, "noContext"));
    }
  }

  renderSuggestedPrompts() {
    this.suggestedEl.empty();
    this.suggestedEl.createSpan({ cls: "md-ai-writer-section-label", text: uiText(this.plugin.settings, "quickPrompts") });
    for (const prompt of this.plugin.getQuickPrompts()) {
      const chip = this.suggestedEl.createEl("button", {
        cls: "md-ai-writer-prompt-chip",
        text: prompt.name,
        attr: { title: prompt.prompt }
      });
      chip.onclick = () => this.usePrompt(prompt.prompt);
    }
  }

  showPromptMenu() {
    new SuggestedPromptModal(this.app, this.plugin, (prompt) => this.usePrompt(prompt)).open();
  }

  usePrompt(prompt: string) {
    const selected = this.plugin.getActiveMarkdownView()?.editor.getSelection().trim();
    const activeName = this.plugin.getActiveMarkdownView()?.file?.basename ?? uiText(this.plugin.settings, "activeNoteFallback");
    this.inputEl.value = prompt.split("{}").join(selected || "{activeNote}").replace("{activeNote}", activeName);
    this.inputEl.focus();
  }

  async openFileByPath(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
      this.plugin.rememberMarkdownLeaf(this.app.workspace.getLeaf(false));
      this.useActiveNoteContext = true;
      this.refreshContextLabel();
    }
  }

  async useContextSelection(selection: ContextSelection) {
    if (selection.type === "file") {
      await this.openFileByPath(selection.path);
      return;
    }
    if (!this.historyContextItems.some((item) => item.createdAt === selection.item.createdAt)) {
      this.historyContextItems.push(selection.item);
    }
    this.refreshContextLabel();
  }

  async buildContext(): Promise<string> {
    const parts: string[] = [];
    if (this.sessionTurns.length) {
      const history = this.sessionTurns
        .slice(-4)
        .map((turn, index) => `Turn ${index + 1}\nUser:\n${turn.prompt}\n\nAssistant:\n${turn.answer}`)
        .join("\n\n---\n\n");
      parts.push(`<current_chat_history>\n${history}\n</current_chat_history>`);
    }
    if (this.useActiveNoteContext) {
      const active = await this.plugin.getActiveContext();
      if (active) parts.push(active);
    }
    for (const item of this.historyContextItems) {
      parts.push(this.plugin.formatHistoryContext(item));
    }
    return parts.join("\n\n");
  }

  recordAssistantAnswer(prompt: string, answer: string) {
    this.sessionTurns.push({ prompt, answer: answer.slice(0, 6000) });
    this.sessionTurns = this.sessionTurns.slice(-8);
    void this.plugin.rememberAssistantAnswer(prompt, answer);
    void this.plugin.writeMemorySummary(prompt, answer);
  }

  addProgress(message: string): HTMLPreElement {
    this.suggestedEl.hide();
    const item = this.logEl.createDiv({ cls: "md-ai-writer-message md-ai-writer-assistant md-ai-writer-progress" });
    const pre = item.createEl("pre", { text: message });
    this.logEl.scrollTop = this.logEl.scrollHeight;
    return pre;
  }

  updateProgress(pre: HTMLPreElement, message: string) {
    pre.setText(message);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  async ask() {
    const prompt = this.inputEl.value.trim();
    if (!prompt) return;
    this.refreshContextLabel();
    this.inputEl.value = "";
    this.addLog("user", prompt);
    await this.plugin.rememberPrompt(prompt);
    const progress = this.addProgress(uiText(this.plugin.settings, "progressPreparing"));
    try {
      if (isCurrentModelQuestion(prompt)) {
        const config = this.plugin.getProviderConfig();
        const provider = this.plugin.getProviderDisplayName();
        const answer = this.plugin.settings.uiLanguage === "en"
          ? `This conversation is currently using ${provider} / ${config.model || "no model selected"} in ${modeLabel(this.plugin.settings, this.mode)} mode.`
          : `這次對話目前使用的是 ${provider} / ${config.model || "未選擇模型"}，當前模式是「${modeLabel(this.plugin.settings, this.mode)}」。`;
        this.updateProgress(progress, uiText(this.plugin.settings, "progressChatDone"));
        this.addLog("assistant", answer);
        this.recordAssistantAnswer(prompt, answer);
        return;
      }
      const context = await this.buildContext();
      if (this.mode === "edit") {
        this.updateProgress(progress, uiText(this.plugin.settings, "progressEdit"));
        const actions = await this.plugin.planEditCurrentNote(prompt);
        this.updateProgress(progress, uiText(this.plugin.settings, "progressConfirmEdit"));
        await this.plugin.applyActions(actions);
        const message = actions.length ? uiText(this.plugin.settings, "editDone") : uiText(this.plugin.settings, "editNoActions");
        this.addLog("assistant", message);
        this.recordAssistantAnswer(prompt, message);
        return;
      }
      if (this.mode === "knowledge") {
        this.updateProgress(progress, uiText(this.plugin.settings, "progressKnowledge"));
        const answer = await this.plugin.answerWithKnowledgeSearch(prompt, context, this.plugin.settings.knowledgeFolders);
        this.updateProgress(progress, uiText(this.plugin.settings, "progressKnowledgeDone"));
        this.addLog("assistant", answer);
        this.recordAssistantAnswer(prompt, answer);
        return;
      }
      if (this.mode === "new") {
        this.updateProgress(progress, uiText(this.plugin.settings, "progressNew"));
        const actions = await this.plugin.planNewNote(prompt, context);
        this.updateProgress(progress, uiText(this.plugin.settings, "progressConfirmNew"));
        await this.plugin.applyActions(actions);
        const message = actions.length ? uiText(this.plugin.settings, "newDone") : uiText(this.plugin.settings, "newNoActions");
        this.addLog("assistant", message);
        this.recordAssistantAnswer(prompt, message);
        return;
      }
      if (this.mode === "chat") {
        this.updateProgress(progress, uiText(this.plugin.settings, "progressChat"));
        const answer = await this.plugin.completeChatOnly(prompt, context);
        this.updateProgress(progress, uiText(this.plugin.settings, "progressChatDone"));
        this.addLog("assistant", answer);
        this.recordAssistantAnswer(prompt, answer);
        return;
      }
      const handled = await this.plugin.tryHandleFileActionFromChat(prompt, context);
      if (handled) {
        const message = uiText(this.plugin.settings, "fileActionDone");
        this.addLog("assistant", message);
        this.recordAssistantAnswer(prompt, message);
        return;
      }
      const answer = await this.plugin.completeWithCliAgent(prompt, context);
      const applied = await this.plugin.tryApplyFileActionText(answer);
      if (applied) {
        const message = uiText(this.plugin.settings, "fileActionApplied");
        this.addLog("assistant", message);
        this.recordAssistantAnswer(prompt, message);
        return;
      }
      this.addLog("assistant", answer);
      this.recordAssistantAnswer(prompt, answer);
    } catch (error) {
      new Notice(String(error));
      this.updateProgress(progress, uiText(this.plugin.settings, "progressFailed"));
      this.addLog("error", String(error));
    }
  }

  async applyFileActions() {
    const prompt = this.inputEl.value.trim();
    if (!prompt) return;
    this.refreshContextLabel();
    this.inputEl.value = "";
    this.addLog("user", prompt);
    await this.plugin.rememberPrompt(prompt);
    try {
      const context = await this.plugin.getActiveContext();
      const actions = await this.plugin.planFileActions(prompt, context);
      this.addLog("assistant", `已規劃 ${actions.length} 個文件操作。`);
      await this.plugin.applyActions(actions);
    } catch (error) {
      new Notice(String(error));
      this.addLog("error", String(error));
    }
  }

  async editActiveNote() {
    const prompt = this.inputEl.value.trim();
    if (!prompt) return;
    this.refreshContextLabel();
    this.inputEl.value = "";
    this.addLog("user", prompt);
    await this.plugin.rememberPrompt(prompt);
    try {
      await this.plugin.editActiveNote(prompt);
      this.addLog("assistant", "已產生修改方案，請在確認窗口檢查後套用。");
    } catch (error) {
      new Notice(String(error));
      this.addLog("error", String(error));
    }
  }

  createNote() {
    new CreateNoteModal(this.app, async (path, prompt) => {
      const content = await this.plugin.completeText(`Create a Markdown note at ${path} for this request:\n${prompt}`, "");
      await this.plugin.createOrReplaceFile(path, content, false);
      await this.plugin.rememberPrompt(prompt);
      this.addLog("assistant", `已新建/更新：${normalizeMarkdownPath(path)}`);
    }).open();
  }
}

class ModelPickerModal extends Modal {
  plugin: MdAiWriterPlugin;
  onChange: () => void;

  constructor(app: App, plugin: MdAiWriterPlugin, onChange: () => void) {
    super(app);
    this.plugin = plugin;
    this.onChange = onChange;
  }

  slider(_name: string, _desc: string, _min: number, _max: number, _step: number, _value: number, _onChange: (value: number) => Promise<void>) {
    return;
  }

  optionalSlider(_name: string, _desc: string, _min: number, _max: number, _step: number, _value: number | null, _onChange: (value: number | null) => Promise<void>) {
    return;
  }

  renderChineseSettings() {
    const isEn = this.plugin.settings.uiLanguage === "en";
    this.contentEl.empty();
    this.contentEl.addClass("md-ai-writer-chat-settings");
    const header = this.contentEl.createDiv({ cls: "md-ai-writer-modal-header" });
    header.createEl("h2", { text: isEn ? "Chat Settings" : "對話設定" });
    const reset = header.createEl("button", { text: isEn ? "Reset" : "重設" });
    reset.onclick = async () => {
      this.plugin.settings.temperature = DEFAULT_SETTINGS.temperature;
      this.plugin.settings.maxTokens = DEFAULT_SETTINGS.maxTokens;
      this.plugin.settings.topP = DEFAULT_SETTINGS.topP;
      this.plugin.settings.frequencyPenalty = DEFAULT_SETTINGS.frequencyPenalty;
      this.plugin.settings.reasoningEffort = DEFAULT_SETTINGS.reasoningEffort;
      await this.plugin.saveSettings();
      this.renderChineseSettings();
    };

    new Setting(this.contentEl)
      .setName(isEn ? "System prompt" : "系統提示詞")
      .setDesc(isEn ? "Controls the AI's fixed role, tone, and work rules. Edit/New modes still add file-action rules." : "控制 AI 的固定角色、語氣和工作規則。Edit/New 模式仍會額外加入文件操作規則。")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.systemPrompt).onChange(async (value) => {
          this.plugin.settings.systemPrompt = value;
          await this.plugin.saveSettings();
        })
      );

    this.slider(isEn ? "Token limit" : "Token 上限", isEn ? "Limits the maximum output tokens for one response. Higher values handle longer text but cost more and take longer." : "限制單次回覆最多輸出的 token。越高越能處理長文，但成本與等待時間也會提高。", 1000, 32000, 500, this.plugin.settings.maxTokens, async (value) => {
      this.plugin.settings.maxTokens = value;
      await this.plugin.saveSettings();
    });
    this.slider("Temperature", isEn ? "Controls randomness. Lower values are steadier for editing; higher values are more creative." : "控制回答的發散程度。低值更穩定，較適合整理和改寫；高值較有創意。", 0, 1, 0.05, this.plugin.settings.temperature, async (value) => {
      this.plugin.settings.temperature = value;
      await this.plugin.saveSettings();
    });
    this.optionalSlider("Top-P", isEn ? "Another randomness control. Usually avoid changing Temperature and Top-P heavily at the same time." : "另一種控制隨機性的參數。通常不用同時大幅調整 Temperature 和 Top-P。", 0, 1, 0.05, this.plugin.settings.topP, async (value) => {
      this.plugin.settings.topP = value;
      await this.plugin.saveSettings();
    });
    this.optionalSlider("Frequency Penalty", isEn ? "Reduces repeated wording. Slightly increase it for long-form cleanup if the model repeats itself." : "降低模型重複用詞的機率。長文整理時可略微提高，避免重複句式。", -2, 2, 0.1, this.plugin.settings.frequencyPenalty, async (value) => {
      this.plugin.settings.frequencyPenalty = value;
      await this.plugin.saveSettings();
    });

    new Setting(this.contentEl)
      .setName(isEn ? "Reasoning effort" : "推理強度")
      .setDesc(isEn ? "Used when DeepSeek thinking mode is enabled. high is cheaper; max is better for complex planning." : "DeepSeek thinking mode 啟用時使用。high 較省，max 較適合複雜規劃。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("high", "high")
          .addOption("max", "max")
          .setValue(this.plugin.settings.reasoningEffort)
          .onChange(async (value) => {
            this.plugin.settings.reasoningEffort = value as ReasoningEffort;
            await this.plugin.saveSettings();
          })
      );

    this.contentEl.createEl("p", {
      cls: "md-ai-writer-settings-note",
      text: isEn
        ? "These settings affect chat requests in this plugin. Models, API keys, and base URLs are configured in the Model settings tab."
        : "這些設定會影響目前插件的對話請求；模型、API Key 和 Base URL 請到 Model 設定頁調整。"
    });
  }

  onOpen() {
    const isEn = this.plugin.settings.uiLanguage === "en";
    this.contentEl.empty();
    this.contentEl.addClass("md-ai-writer-picker");
    this.contentEl.createEl("h2", { text: uiText(this.plugin.settings, "selectModel") });
    const deepseek = this.plugin.settings.providers.deepseek;
    this.renderProviderModels("deepseek", undefined, "DeepSeek", deepseek, isEn);
    for (const custom of this.plugin.getCustomProviders()) {
      this.renderProviderModels("custom", custom.id, custom.name || (isEn ? "Custom endpoint" : "自定義接口"), custom, isEn);
    }
  }

  renderProviderModels(provider: ProviderId, customId: string | undefined, title: string, config: ProviderConfig, isEn: boolean) {
    const section = this.contentEl.createDiv({ cls: "md-ai-writer-picker-section" });
    section.createEl("h3", { text: title });
    for (const model of this.plugin.getModelOptions(provider, customId)) {
      const row = section.createEl("button", { cls: "md-ai-writer-model-row" });
      row.createSpan({ text: model });
      row.createSpan({ cls: "md-ai-writer-model-provider", text: config.apiKey ? (isEn ? "Ready" : "可用") : (isEn ? "Needs API key" : "需要 API Key") });
      if (this.plugin.settings.provider === provider && (provider === "deepseek" || this.plugin.settings.activeCustomProviderId === customId) && config.model === model) row.addClass("is-active");
      row.onclick = async () => {
        this.plugin.settings.provider = provider;
        if (provider === "custom" && customId) this.plugin.settings.activeCustomProviderId = customId;
        config.model = model;
        await this.plugin.saveSettings();
        this.onChange();
        this.close();
      };
    }
  }
}

class ChatSettingsModal extends Modal {
  plugin: MdAiWriterPlugin;
  onChange: () => void;

  constructor(app: App, plugin: MdAiWriterPlugin, onChange: () => void) {
    super(app);
    this.plugin = plugin;
    this.onChange = onChange;
  }

  renderChineseSettings() {
    this.contentEl.empty();
    this.contentEl.addClass("md-ai-writer-chat-settings");
    const header = this.contentEl.createDiv({ cls: "md-ai-writer-modal-header" });
    header.createEl("h2", { text: "對話設定" });
    const reset = header.createEl("button", { text: "重設" });
    reset.onclick = async () => {
      this.plugin.settings.temperature = DEFAULT_SETTINGS.temperature;
      this.plugin.settings.maxTokens = DEFAULT_SETTINGS.maxTokens;
      this.plugin.settings.topP = DEFAULT_SETTINGS.topP;
      this.plugin.settings.frequencyPenalty = DEFAULT_SETTINGS.frequencyPenalty;
      this.plugin.settings.reasoningEffort = DEFAULT_SETTINGS.reasoningEffort;
      await this.plugin.saveSettings();
      this.renderChineseSettings();
    };

    new Setting(this.contentEl)
      .setName("系統提示詞")
      .setDesc("控制 AI 的固定角色、語氣和工作規則。Edit/New 模式仍會額外加入文件操作規則。")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.systemPrompt).onChange(async (value) => {
          this.plugin.settings.systemPrompt = value;
          await this.plugin.saveSettings();
        })
      );

    this.slider("Token 上限", "限制單次回覆最多輸出的 token。越高越能處理長文，但成本與等待時間也會提高。", 1000, 32000, 500, this.plugin.settings.maxTokens, async (value) => {
      this.plugin.settings.maxTokens = value;
      await this.plugin.saveSettings();
    });
    this.slider("Temperature", "控制回答的發散程度。低值更穩定，較適合整理和改寫；高值較有創意。", 0, 1, 0.05, this.plugin.settings.temperature, async (value) => {
      this.plugin.settings.temperature = value;
      await this.plugin.saveSettings();
    });
    this.optionalSlider("Top-P", "另一種控制隨機性的參數。通常不用同時大幅調整 Temperature 和 Top-P。", 0, 1, 0.05, this.plugin.settings.topP, async (value) => {
      this.plugin.settings.topP = value;
      await this.plugin.saveSettings();
    });
    this.optionalSlider("Frequency Penalty", "降低模型重複用詞的機率。長文整理時可略微提高，避免重複句式。", -2, 2, 0.1, this.plugin.settings.frequencyPenalty, async (value) => {
      this.plugin.settings.frequencyPenalty = value;
      await this.plugin.saveSettings();
    });

    new Setting(this.contentEl)
      .setName("推理強度")
      .setDesc("DeepSeek thinking mode 啟用時使用。high 較省，max 較適合複雜規劃。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("high", "high")
          .addOption("max", "max")
          .setValue(this.plugin.settings.reasoningEffort)
          .onChange(async (value) => {
            this.plugin.settings.reasoningEffort = value as ReasoningEffort;
            await this.plugin.saveSettings();
          })
      );

    this.contentEl.createEl("p", {
      cls: "md-ai-writer-settings-note",
      text: "這些設定會影響目前插件的對話請求；模型、API Key 和 Base URL 請到 Model 設定頁調整。"
    });
  }

  onOpen() {
    this.renderChineseSettings();
    return;
    this.contentEl.empty();
    this.contentEl.addClass("md-ai-writer-chat-settings");
    const header = this.contentEl.createDiv({ cls: "md-ai-writer-modal-header" });
    header.createEl("h2", { text: "Chat Settings" });
    const reset = header.createEl("button", { text: "↻ Reset" });
    reset.onclick = async () => {
      this.plugin.settings.temperature = DEFAULT_SETTINGS.temperature;
      this.plugin.settings.maxTokens = DEFAULT_SETTINGS.maxTokens;
      this.plugin.settings.topP = DEFAULT_SETTINGS.topP;
      this.plugin.settings.frequencyPenalty = DEFAULT_SETTINGS.frequencyPenalty;
      this.plugin.settings.reasoningEffort = DEFAULT_SETTINGS.reasoningEffort;
      await this.plugin.saveSettings();
      this.onOpen();
    };

    new Setting(this.contentEl)
      .setName("System Prompt")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.systemPrompt).onChange(async (value) => {
          this.plugin.settings.systemPrompt = value;
          await this.plugin.saveSettings();
        })
      );

    this.slider("Token limit", 1000, 32000, 500, this.plugin.settings.maxTokens, async (value) => {
      this.plugin.settings.maxTokens = value;
      await this.plugin.saveSettings();
    });
    this.slider("Temperature", 0, 1, 0.05, this.plugin.settings.temperature, async (value) => {
      this.plugin.settings.temperature = value;
      await this.plugin.saveSettings();
    });
    this.optionalSlider("Top-P", 0, 1, 0.05, this.plugin.settings.topP, async (value) => {
      this.plugin.settings.topP = value;
      await this.plugin.saveSettings();
    });
    this.optionalSlider("Frequency Penalty", -2, 2, 0.1, this.plugin.settings.frequencyPenalty, async (value) => {
      this.plugin.settings.frequencyPenalty = value;
      await this.plugin.saveSettings();
    });

    new Setting(this.contentEl)
      .setName("Reasoning Effort")
      .setDesc("DeepSeek thinking mode 使用。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("high", "high")
          .addOption("max", "max")
          .setValue(this.plugin.settings.reasoningEffort)
          .onChange(async (value) => {
            this.plugin.settings.reasoningEffort = value as ReasoningEffort;
            await this.plugin.saveSettings();
          })
      );

    this.contentEl.createEl("p", {
      cls: "md-ai-writer-settings-note",
      text: "System Prompt applies to this chat session; model settings are bound to the current model."
    });
  }

  slider(name: string, descOrMin: string | number, minOrMax: number, maxOrStep: number, stepOrValue: number, valueOrOnChange: number | ((value: number) => Promise<void>), maybeOnChange?: (value: number) => Promise<void>) {
    const hasDesc = typeof descOrMin === "string";
    const desc = hasDesc ? descOrMin : "";
    const min = hasDesc ? minOrMax : descOrMin;
    const max = hasDesc ? maxOrStep : minOrMax;
    const step = (hasDesc ? stepOrValue : maxOrStep) as number;
    const value = hasDesc ? valueOrOnChange as number : stepOrValue;
    const onChange = (hasDesc ? maybeOnChange : valueOrOnChange) as (value: number) => Promise<void>;
    new Setting(this.contentEl).setName(name).setDesc(desc ? `${desc} 目前值：${value}` : String(value)).addSlider((slider) =>
      slider.setLimits(min, max, step).setValue(value).setDynamicTooltip().onChange(onChange)
    );
  }

  optionalSlider(name: string, descOrMin: string | number, minOrMax: number, maxOrStep: number, stepOrValue: number | null, valueOrOnChange: number | null | ((value: number | null) => Promise<void>), maybeOnChange?: (value: number | null) => Promise<void>) {
    const hasDesc = typeof descOrMin === "string";
    const min = hasDesc ? minOrMax : descOrMin;
    const max = hasDesc ? maxOrStep : minOrMax;
    const step = (hasDesc ? stepOrValue : maxOrStep) as number;
    const value = hasDesc ? valueOrOnChange as number | null : stepOrValue as number | null;
    const onChange = (hasDesc ? maybeOnChange : valueOrOnChange) as (value: number | null) => Promise<void>;
    const setting = new Setting(this.contentEl).setName(name).setDesc(value === null ? (this.plugin.settings.uiLanguage === "en" ? "Disabled" : "已停用") : String(value));
    setting.addToggle((toggle) =>
      toggle.setValue(value !== null).onChange(async (enabled) => {
        await onChange(enabled ? min : null);
        this.onOpen();
      })
    );
    setting.addSlider((slider) =>
      slider
        .setLimits(min, max, step)
        .setValue(value ?? min)
        .setDynamicTooltip()
        .onChange(async (next) => {
          if (value !== null) await onChange(next);
        })
    );
  }
}

class ChatHistoryModal extends Modal {
  plugin: MdAiWriterPlugin;
  onSelect: (prompt: string) => void;
  selected = new Set<number>();

  constructor(app: App, plugin: MdAiWriterPlugin, onSelect: (prompt: string) => void) {
    super(app);
    this.plugin = plugin;
    this.onSelect = onSelect;
  }

  renderManagedHistory() {
    const isEn = this.plugin.settings.uiLanguage === "en";
    this.contentEl.empty();
    this.contentEl.addClass("md-ai-writer-history");
    this.contentEl.createEl("h2", { text: isEn ? "Chat history" : "歷史交流紀錄" });
    const search = this.contentEl.createEl("input", { attr: { placeholder: isEn ? "Search title or content..." : "搜尋標題或內容..." } });
    const actions = this.contentEl.createDiv({ cls: "md-ai-writer-history-actions" });
    const deleteSelected = actions.createEl("button", { text: isEn ? "Delete selected" : "刪除已選" });
    const clearAll = actions.createEl("button", { text: isEn ? "Clear all" : "清空全部" });
    const list = this.contentEl.createDiv({ cls: "md-ai-writer-history-list" });

    const render = () => {
      list.empty();
      const query = search.value.toLowerCase();
      const items = this.plugin.settings.chatHistory.filter((entry) => historyMatchesQuery(entry, query));
      if (!items.length) {
        list.createDiv({ cls: "md-ai-writer-muted", text: isEn ? "No matching records." : "沒有符合的紀錄。" });
        return;
      }
      for (const item of items) {
        const row = list.createDiv({ cls: "md-ai-writer-history-row md-ai-writer-history-manage-row" });
        const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
        checkbox.checked = this.selected.has(item.createdAt);
        checkbox.onchange = () => {
          if (checkbox.checked) this.selected.add(item.createdAt);
          else this.selected.delete(item.createdAt);
        };
        const main = row.createEl("button", { cls: "md-ai-writer-history-main" });
        main.createSpan({ text: item.title || item.prompt?.slice(0, 60) || (isEn ? "Untitled chat" : "未命名對話") });
        main.createSpan({ cls: "md-ai-writer-model-provider", text: formatMemoryTime(new Date(item.createdAt)) });
        main.onclick = () => {
          this.onSelect(item.prompt);
          this.close();
        };
        row.createEl("button", { cls: "md-ai-writer-history-delete", text: isEn ? "Delete" : "刪除" }).onclick = async () => {
          this.plugin.settings.chatHistory = this.plugin.settings.chatHistory.filter((entry) => entry.createdAt !== item.createdAt);
          this.selected.delete(item.createdAt);
          await this.plugin.saveSettings();
          render();
        };
      }
    };

    deleteSelected.onclick = async () => {
      if (!this.selected.size) return;
      this.plugin.settings.chatHistory = this.plugin.settings.chatHistory.filter((item) => !this.selected.has(item.createdAt));
      this.selected.clear();
      await this.plugin.saveSettings();
      render();
    };
    clearAll.onclick = async () => {
      this.plugin.settings.chatHistory = [];
      this.selected.clear();
      await this.plugin.saveSettings();
      render();
    };
    search.oninput = render;
    render();
    search.focus();
  }

  onOpen() {
    this.renderManagedHistory();
    return;
    this.contentEl.empty();
    this.contentEl.addClass("md-ai-writer-history");
    const search = this.contentEl.createEl("input", { attr: { placeholder: "Search..." } });
    const list = this.contentEl.createDiv();
    const render = () => {
      list.empty();
      const query = search.value.toLowerCase();
      for (const item of this.plugin.settings.chatHistory.filter((entry) => historyMatchesQuery(entry, query))) {
        const row = list.createEl("button", { cls: "md-ai-writer-history-row" });
        row.createSpan({ text: "◌" });
        row.createSpan({ text: item.title });
        row.onclick = () => {
          this.onSelect(item.prompt);
          this.close();
        };
      }
    };
    search.oninput = render;
    render();
    search.focus();
  }
}

class ContextPickerModal extends Modal {
  plugin: MdAiWriterPlugin;
  onSelect: (selection: ContextSelection) => void;

  constructor(app: App, plugin: MdAiWriterPlugin, onSelect: (selection: ContextSelection) => void) {
    super(app);
    this.plugin = plugin;
    this.onSelect = onSelect;
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("md-ai-writer-history");
    const isEn = this.plugin.settings.uiLanguage === "en";
    const search = this.contentEl.createEl("input", { attr: { placeholder: isEn ? "Search Markdown files or chat history..." : "搜尋 Markdown 文件或歷史交流..." } });
    const list = this.contentEl.createDiv();
    const render = () => {
      list.empty();
      const query = search.value.toLowerCase();
      for (const file of this.app.vault.getMarkdownFiles().filter((entry) => entry.path.toLowerCase().includes(query)).slice(0, 80)) {
        const row = list.createEl("button", { cls: "md-ai-writer-history-row" });
        setIcon(row.createSpan(), "file-text");
        row.createSpan({ text: file.path });
        row.onclick = () => {
          this.onSelect({ type: "file", path: file.path });
          this.close();
        };
      }
      for (const item of this.plugin.settings.chatHistory.filter((entry) => historyMatchesQuery(entry, query)).slice(0, 40)) {
        const row = list.createEl("button", { cls: "md-ai-writer-history-row" });
        setIcon(row.createSpan(), "messages-square");
        row.createSpan({ text: `${isEn ? "Chat history" : "交流紀錄"}：${item.title}` });
        row.onclick = () => {
          this.onSelect({ type: "history", item });
          this.close();
        };
      }
    };
    search.oninput = render;
    render();
    search.focus();
  }
}

class KnowledgeFolderModal extends Modal {
  plugin: MdAiWriterPlugin;
  onSave: (folders: string[]) => Promise<void>;
  selected: Set<string>;

  constructor(app: App, plugin: MdAiWriterPlugin, onSave: (folders: string[]) => Promise<void>) {
    super(app);
    this.plugin = plugin;
    this.onSave = onSave;
    this.selected = new Set(plugin.settings.knowledgeFolders);
  }

  onOpen() {
    const isEn = this.plugin.settings.uiLanguage === "en";
    this.contentEl.empty();
    this.contentEl.addClass("md-ai-writer-folder-picker");
    this.contentEl.createEl("h2", { text: `${knowledgeModeTitle(this.plugin.settings)} ${uiText(this.plugin.settings, "folders")}` });
    this.contentEl.createEl("p", {
      cls: "md-ai-writer-settings-note",
      text: isEn
        ? "Choose folders used as the search scope. If none are selected, the whole vault is searched and local keywords narrow the candidate snippets first."
        : "勾選要用作記憶搜尋範圍的資料夾。未勾選時會搜尋全庫，並先用本地關鍵字縮小候選片段。"
    });

    const actions = this.contentEl.createDiv({ cls: "md-ai-writer-folder-actions" });
    actions.createEl("button", { text: isEn ? "Select all" : "全選" }).onclick = () => {
      this.selected = new Set(this.plugin.getVaultFolders());
      this.onOpen();
    };
    actions.createEl("button", { text: isEn ? "Clear" : "清空" }).onclick = () => {
      this.selected.clear();
      this.onOpen();
    };

    const folders = this.plugin.getVaultFolders();
    const list = this.contentEl.createDiv({ cls: "md-ai-writer-folder-list" });
    if (!folders.length) {
      list.createDiv({ cls: "md-ai-writer-muted", text: isEn ? "No folders available." : "未找到可選資料夾。" });
    }
    for (const folder of folders) {
      const label = list.createEl("label", { cls: "md-ai-writer-folder-row" });
      const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = this.selected.has(folder);
      checkbox.onchange = () => {
        if (checkbox.checked) this.selected.add(folder);
        else this.selected.delete(folder);
      };
      label.createSpan({ text: folder });
    }

    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText(isEn ? "Save" : "保存")
          .setCta()
          .onClick(async () => {
            await this.onSave(Array.from(this.selected).sort((a, b) => a.localeCompare(b)));
            this.close();
          })
      )
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()));
  }
}

class SuggestedPromptModal extends Modal {
  plugin: MdAiWriterPlugin;
  onSelect: (prompt: string) => void;

  constructor(app: App, plugin: MdAiWriterPlugin, onSelect: (prompt: string) => void) {
    super(app);
    this.plugin = plugin;
    this.onSelect = onSelect;
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("md-ai-writer-picker");
    this.contentEl.createEl("h2", { text: "Custom Prompts" });
    for (const prompt of this.plugin.getQuickPrompts()) {
      const row = this.contentEl.createEl("button", { cls: "md-ai-writer-model-row" });
      row.createSpan({ text: prompt.name });
      row.createSpan({ cls: "md-ai-writer-model-provider", text: prompt.prompt });
      row.onclick = () => {
        this.onSelect(prompt.prompt);
        this.close();
      };
    }
  }
}

class CliOutputModal extends Modal {
  title: string;
  output: string;

  constructor(app: App, title: string, output: string) {
    super(app);
    this.title = title;
    this.output = output;
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: this.title });
    this.contentEl.createEl("pre", { cls: "md-ai-writer-preview", text: this.output });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("關閉").onClick(() => this.close()));
  }
}

class PromptModal extends Modal {
  title: string;
  placeholder: string;
  onSubmit: (value: string) => Promise<void>;
  valueEl: HTMLTextAreaElement;

  constructor(app: App, title: string, placeholder: string, onSubmit: (value: string) => Promise<void>) {
    super(app);
    this.title = title;
    this.placeholder = placeholder;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: this.title });
    this.valueEl = this.contentEl.createEl("textarea", {
      cls: "md-ai-writer-modal-textarea",
      attr: { placeholder: this.placeholder }
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("執行")
          .setCta()
          .onClick(async () => {
            const value = this.valueEl.value.trim();
            if (!value) return;
            this.close();
            try {
              await this.onSubmit(value);
            } catch (error) {
              new Notice(String(error));
            }
          })
      );
    this.valueEl.focus();
  }
}

class CreateNoteModal extends Modal {
  onSubmit: (path: string, prompt: string) => Promise<void>;
  pathEl: HTMLInputElement;
  promptEl: HTMLTextAreaElement;

  constructor(app: App, onSubmit: (path: string, prompt: string) => Promise<void>) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "AI 新建 Markdown" });
    new Setting(this.contentEl).setName("文件路徑").addText((text) => {
      this.pathEl = text.inputEl;
      text.setPlaceholder("folder/new-note.md");
    });
    this.promptEl = this.contentEl.createEl("textarea", {
      cls: "md-ai-writer-modal-textarea",
      attr: { placeholder: "描述要新建的筆記內容..." }
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("新建")
          .setCta()
          .onClick(async () => {
            const path = this.pathEl.value.trim();
            const prompt = this.promptEl.value.trim();
            if (!path || !prompt) return;
            this.close();
            try {
              await this.onSubmit(path, prompt);
              new Notice(`已創建 ${normalizeMarkdownPath(path)}`);
            } catch (error) {
              new Notice(String(error));
            }
          })
      );
  }
}

class ConfirmActionsModal extends Modal {
  actions: FileAction[];
  onConfirm: () => Promise<void>;

  constructor(app: App, actions: FileAction[], onConfirm: () => Promise<void>) {
    super(app);
    this.actions = actions;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "確認 AI 文件操作" });
    const preview = this.actions
      .map((action, index) => `${index + 1}. ${action.action} ${action.path ?? "(active selection)"}\n${action.content.slice(0, 700)}`)
      .join("\n\n---\n\n");
    this.contentEl.createDiv({ cls: "md-ai-writer-preview", text: preview });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("套用")
          .setCta()
          .onClick(async () => {
            this.close();
            try {
              await this.onConfirm();
            } catch (error) {
              new Notice(String(error));
            }
          })
      );
  }
}

class MdAiWriterSettingTab extends PluginSettingTab {
  plugin: MdAiWriterPlugin;
  activeTab: "basic" | "model" | "command" | "knowledge" | "advanced" = "basic";

  constructor(app: App, plugin: MdAiWriterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: this.plugin.settings.uiLanguage === "en" ? `${APP_NAME} Settings` : `${APP_NAME} 設定` });
    this.renderTabs(containerEl);
    if (this.activeTab === "basic") this.renderBasic(containerEl);
    if (this.activeTab === "model") this.renderModel(containerEl);
    if (this.activeTab === "command") this.renderCommand(containerEl);
    if (this.activeTab === "knowledge") this.renderKnowledge(containerEl);
    if (this.activeTab === "advanced") this.renderAdvanced(containerEl);
  }

  renderTabs(containerEl: HTMLElement) {
    const tabs = containerEl.createDiv({ cls: "md-ai-writer-settings-tabs" });
    const isEn = this.plugin.settings.uiLanguage === "en";
    const items: Array<[typeof this.activeTab, string]> = [
      ["basic", isEn ? "Basic" : "基本"],
      ["model", isEn ? "Model" : "模型"],
      ["command", isEn ? "Command" : "指令"],
      ["knowledge", isEn ? "Search" : "搜尋"],
      ["advanced", isEn ? "Advanced" : "進階"]
    ];
    for (const [id, label] of items) {
      const button = tabs.createEl("button", { text: label });
      if (this.activeTab === id) button.addClass("is-active");
      button.onclick = () => {
        this.activeTab = id;
        this.display();
      };
    }
  }

  renderModel(containerEl: HTMLElement) {
    const isEn = this.plugin.settings.uiLanguage === "en";
    new Setting(containerEl)
      .setName(isEn ? "Model provider" : "模型提供者")
      .setDesc(isEn ? "Choose DeepSeek or one of your saved OpenAI-compatible endpoints." : "選擇 DeepSeek 或你保存的其中一個 OpenAI-compatible 自定義接口。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("deepseek", "DeepSeek")
          .addOption("custom", isEn ? "Custom endpoint" : "自定義接口")
          .setValue(this.plugin.settings.provider)
          .onChange(async (value) => {
            this.plugin.settings.provider = value as ProviderId;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.provider === "custom") {
      new Setting(containerEl)
        .setName(isEn ? "Custom API" : "自定義 API")
        .setDesc(isEn ? "Switch between saved custom endpoints. Each endpoint keeps its own API key, base URL, model list, and API mode." : "切換已保存的自定義接口；每個接口會獨立保存 API Key、Base URL、模型清單與 API 模式。")
        .addDropdown((dropdown) => {
          for (const custom of this.plugin.getCustomProviders()) {
            dropdown.addOption(custom.id, custom.name || (isEn ? "Custom endpoint" : "自定義接口"));
          }
          return dropdown.setValue(this.plugin.settings.activeCustomProviderId).onChange(async (value) => {
            this.plugin.settings.activeCustomProviderId = value;
            await this.plugin.saveSettings();
            this.display();
          });
        })
        .addButton((button) =>
          button.setButtonText(isEn ? "Add" : "新增").onClick(async () => {
            const next = createCustomProviderConfig(undefined, createCustomProviderId(), isEn ? `Custom endpoint ${this.plugin.getCustomProviders().length + 1}` : `自定義接口 ${this.plugin.getCustomProviders().length + 1}`);
            this.plugin.settings.customProviders.push(next);
            this.plugin.settings.provider = "custom";
            this.plugin.settings.activeCustomProviderId = next.id;
            await this.plugin.saveSettings();
            this.display();
          })
        );
    }

    new Setting(containerEl)
      .setName(isEn ? "Current model" : "當前模型")
      .setDesc(isEn ? "The chat panel can also switch models temporarily; the change is saved." : "對話框內也可以臨時切換，切換後會保存。")
      .addDropdown((dropdown) => {
        const models = this.plugin.getModelOptions();
        if (!models.length) dropdown.addOption("", isEn ? "Add models in the provider settings below" : "請先在下方 provider 設定中填寫模型");
        for (const model of models) dropdown.addOption(model, model);
        return dropdown.setValue(this.plugin.getProviderConfig().model).onChange(async (value) => {
          this.plugin.getProviderConfig().model = value;
          await this.plugin.saveSettings();
        });
      });

    this.renderProviderDetails(containerEl, "deepseek", isEn ? "DeepSeek settings" : "DeepSeek 設定");
    for (const custom of this.plugin.getCustomProviders()) {
      this.renderProviderDetails(containerEl, "custom", custom.name || (isEn ? "Custom endpoint" : "自定義接口"), custom.id);
    }
  }

  renderBasic(containerEl: HTMLElement) {
    const isEn = this.plugin.settings.uiLanguage === "en";

    containerEl.createEl("h3", { text: isEn ? "UI Preferences" : "界面偏好" });

    new Setting(containerEl)
      .setName(isEn ? "Language" : "界面語言")
      .setDesc(isEn ? "Switches the main workbench and settings navigation between Chinese and English." : "切換主要工作區和設定導航的顯示語言。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("zh", "中文")
          .addOption("en", "English")
          .setValue(this.plugin.settings.uiLanguage)
          .onChange(async (value) => {
            this.plugin.settings.uiLanguage = isUiLanguage(value) ? value : DEFAULT_SETTINGS.uiLanguage;
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(isEn ? "Interface font" : "界面字體")
      .setDesc(isEn ? "CSS font-family for the assistant panel. The default uses a Claude Code-like monospace stack." : "輸入 CSS font-family；預設使用類似 Claude Code 的等寬字體組合。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_UI_FONT)
          .setValue(this.plugin.settings.uiFontFamily)
          .onChange(async (value) => {
            this.plugin.settings.uiFontFamily = value.trim() || DEFAULT_UI_FONT;
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
          })
      )
      .addButton((button) =>
        button.setButtonText(isEn ? "Reset" : "重設").onClick(async () => {
          this.plugin.settings.uiFontFamily = DEFAULT_UI_FONT;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
          this.display();
        })
      );

    containerEl.createEl("h3", { text: isEn ? "Generation" : "通用生成設定" });

    new Setting(containerEl).setName(isEn ? "Temperature" : "溫度").setDesc(isEn ? "Higher values make responses more varied. Some compatible relay endpoints may skip this parameter automatically." : "數值越高，回答越發散。部分兼容接口可能會自動略過此參數。").addSlider((slider) =>
      slider
        .setLimits(0, 1, 0.05)
        .setValue(this.plugin.settings.temperature)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.temperature = value;
          await this.plugin.saveSettings();
        })
    );

    new Setting(containerEl)
      .setName(isEn ? "Max output tokens" : "最大輸出 tokens")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.maxTokens)).onChange(async (value) => {
          const parsed = Number(value);
          if (!Number.isNaN(parsed) && parsed > 0) {
            this.plugin.settings.maxTokens = parsed;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName(isEn ? "System prompt" : "系統提示詞")
      .setDesc(isEn ? "Prepended to each request to set the AI's style and behavioral boundaries." : "會附加在每次請求前，用於固定 AI 的寫作風格和行為邊界。")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.systemPrompt).onChange(async (value) => {
          this.plugin.settings.systemPrompt = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(isEn ? "Use JSON output for file actions" : "文件操作使用 JSON Output")
      .setDesc(isEn ? "Asks the model to return JSON so create/edit actions are easier to parse." : "要求模型返回 JSON，讓創建/修改文件更容易解析。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useJsonOutputForActions).onChange(async (value) => {
          this.plugin.settings.useJsonOutputForActions = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(isEn ? "Confirm before applying file actions" : "套用文件操作前先確認")
      .setDesc(isEn ? "Recommended. Prevents AI from directly overwriting the current note." : "建議保持開啟，避免 AI 直接覆寫當前筆記。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.confirmBeforeApply).onChange(async (value) => {
          this.plugin.settings.confirmBeforeApply = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(isEn ? "Attach current Markdown by default" : "對話自動附帶當前 Markdown")
      .setDesc(isEn ? "The chat panel remembers the last Markdown note even after focus moves to the side panel." : "聊天面板取得焦點後仍會記住上一個 Markdown 頁面。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeActiveNoteByDefault).onChange(async (value) => {
          this.plugin.settings.includeActiveNoteByDefault = value;
          await this.plugin.saveSettings();
        })
      );
  }

  renderCommand(containerEl: HTMLElement) {
    const isEn = this.plugin.settings.uiLanguage === "en";
    containerEl.createEl("h3", { text: isEn ? "Quick prompts" : "快速提示詞" });
    new Setting(containerEl)
      .setName(isEn ? "Add quick prompt" : "新增快速提示詞")
      .setDesc(isEn ? "User-managed prompt name and content. {} represents selected text." : "用戶自行設定提示詞名稱和內容；{} 代表選中文本。")
      .addButton((button) =>
        button.setButtonText(isEn ? "Add" : "新增").onClick(async () => {
          this.plugin.settings.quickPrompts.push({
            name: isEn ? "New prompt" : "新提示詞",
            prompt: isEn ? "Enter the prompt here. Use {} for selected text or current content." : "在這裡輸入提示詞，使用 {} 表示選中文本或當前內容。"
          });
          await this.plugin.saveSettings();
          this.display();
        })
      );

    containerEl.createEl("h3", { text: "Memory" });
    new Setting(containerEl)
      .setName(isEn ? "Enable conversation memory" : "啟用對話摘要記憶")
      .setDesc(isEn ? "After each AI response, writes a fixed-format summary into the memory file." : "每次 AI 回答後，把固定格式摘要寫入 memory file。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableMemory).onChange(async (value) => {
          this.plugin.settings.enableMemory = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Memory file")
      .setDesc(isEn ? "For example: md-ai-writer/memory.md." : "例如 md-ai-writer/memory.md。")
      .addText((text) =>
        text.setValue(this.plugin.settings.memoryFilePath).onChange(async (value) => {
          this.plugin.settings.memoryFilePath = value.trim();
          await this.plugin.saveSettings();
        })
      );

    const list = containerEl.createDiv({ cls: "md-ai-writer-prompt-settings-list" });
    this.plugin.getQuickPrompts().forEach((prompt, index) => {
      const row = list.createDiv({ cls: "md-ai-writer-prompt-setting" });
      new Setting(row)
        .setName(isEn ? "Name" : "名稱")
        .addText((text) =>
          text.setValue(prompt.name).onChange(async (value) => {
            this.plugin.settings.quickPrompts[index].name = value;
            await this.plugin.saveSettings();
          })
        )
        .addButton((button) =>
          button.setButtonText(isEn ? "Delete" : "刪除").onClick(async () => {
            this.plugin.settings.quickPrompts.splice(index, 1);
            await this.plugin.saveSettings();
            this.display();
          })
        );
      new Setting(row)
        .setName(isEn ? "Content" : "內容")
        .setDesc(isEn ? "Use {} for selected text. If nothing is selected, it falls back to {activeNote}." : "可使用 {} 代表選中文本；沒有選中時會保留為 {activeNote}。")
        .addTextArea((text) =>
          text.setValue(prompt.prompt).onChange(async (value) => {
            this.plugin.settings.quickPrompts[index].prompt = value;
            await this.plugin.saveSettings();
          })
        );
    });

    new Setting(containerEl)
      .setName(isEn ? "Clear chat history" : "清空聊天歷史")
      .setDesc(isEn ? "Deletes records used by chat history search." : "清除聊天框歷史搜尋中的記錄。")
      .addButton((button) =>
        button.setButtonText(isEn ? "Clear" : "清空").onClick(async () => {
          this.plugin.settings.chatHistory = [];
          await this.plugin.saveSettings();
          new Notice(isEn ? "Chat history cleared." : "已清空聊天歷史。");
        })
      );
  }

  renderKnowledge(containerEl: HTMLElement) {
    const isEn = this.plugin.settings.uiLanguage === "en";
    containerEl.createEl("h3", { text: isEn ? "Search" : "搜尋" });
    containerEl.createEl("p", {
      cls: "md-ai-writer-settings-note",
      text: isEn
        ? "Search reads Markdown from selected folders, splits notes into chunks, narrows candidates locally, optionally reranks with Voyage, then answers with the main chat model. Voyage is used for cheaper and more accurate retrieval ranking, not chat."
        : "搜尋模式會先從勾選資料夾讀取 Markdown，切成片段，本地關鍵字預篩後可交給 Voyage rerank 排序，再用主聊天模型回答。Voyage 不是聊天模型，主要用於更便宜、更準確的檢索排序。"
    });

    new Setting(containerEl)
      .setName(isEn ? "Search folders" : "搜尋資料夾")
      .setDesc(this.plugin.settings.knowledgeFolders.length ? this.plugin.settings.knowledgeFolders.join(", ") : (isEn ? "Searches the whole vault when no folder is selected" : "未勾選時搜尋全庫"))
      .addButton((button) =>
        button.setButtonText(isEn ? "Choose folders" : "選擇資料夾").onClick(() => {
          new KnowledgeFolderModal(this.app, this.plugin, async (folders) => {
            this.plugin.settings.knowledgeFolders = folders;
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
      );

    new Setting(containerEl)
      .setName("Voyage API Key")
      .setDesc(isEn ? "Optional. When empty, only local keyword search is used." : "可留空；留空時只使用本地關鍵字檢索。")
      .addText((text) =>
        text
          .setPlaceholder("pa-...")
          .setValue(this.plugin.settings.voyageApiKey)
          .onChange(async (value) => {
            this.plugin.settings.voyageApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Voyage rerank model")
      .setDesc(isEn ? "Use rerank-2.5-lite first to control cost; switch to rerank-2.5 when ranking quality matters more." : "建議先用 rerank-2.5-lite 控制成本；需要更高排序品質再改 rerank-2.5。")
      .addText((text) =>
        text
          .setPlaceholder("rerank-2.5-lite")
          .setValue(this.plugin.settings.voyageRerankModel)
          .onChange(async (value) => {
            this.plugin.settings.voyageRerankModel = value.trim() || DEFAULT_SETTINGS.voyageRerankModel;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(isEn ? "Candidate limit" : "候選片段上限")
      .setDesc(isEn ? "Number of locally filtered snippets sent to Voyage rerank. Higher values cost more." : "本地預篩後送入 Voyage rerank 的片段數，越大越貴。")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.knowledgeMaxCandidates)).onChange(async (value) => {
          this.plugin.settings.knowledgeMaxCandidates = clampNumber(Number(value), 10, 200, DEFAULT_SETTINGS.knowledgeMaxCandidates);
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(isEn ? "Snippet count" : "引用片段數")
      .setDesc(isEn ? "Final number of snippets passed to the chat model." : "最終交給聊天模型的片段數。")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.knowledgeTopK)).onChange(async (value) => {
          this.plugin.settings.knowledgeTopK = clampNumber(Number(value), 1, 20, DEFAULT_SETTINGS.knowledgeTopK);
          await this.plugin.saveSettings();
        })
      );
  }

  renderAdvanced(containerEl: HTMLElement) {
    const isEn = this.plugin.settings.uiLanguage === "en";
    containerEl.createEl("h3", { text: isEn ? "Advanced" : "進階" });
    containerEl.createEl("h3", { text: isEn ? "Settings profile" : "設定配置檔" });
    containerEl.createEl("p", {
      cls: "md-ai-writer-settings-note",
      text: isEn
        ? `Exports and imports plugin configuration from a Markdown file with a ${SETTINGS_PROFILE_CODE_BLOCK} JSON block. The exported file includes API keys, so keep it private.`
        : `從包含 ${SETTINGS_PROFILE_CODE_BLOCK} JSON 區塊的 Markdown 檔匯入/匯出插件配置。匯出的文件包含 API Key，請勿公開。`
    });
    new Setting(containerEl)
      .setName(isEn ? "Profile MD path" : "配置 MD 路徑")
      .setDesc(isEn ? "Vault-relative Markdown path used for export and import." : "Vault 內相對 Markdown 路徑，用於匯出和載入設定。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS_PROFILE_PATH)
          .setValue(this.plugin.settings.settingsProfilePath)
          .onChange(async (value) => {
            this.plugin.settings.settingsProfilePath = normalizeMarkdownPath(value || DEFAULT_SETTINGS_PROFILE_PATH);
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName(isEn ? "Profile actions" : "配置操作")
      .setDesc(isEn ? "Export overwrites the Markdown profile. Import replaces current plugin settings with the profile content." : "匯出會覆寫配置 MD；載入會用配置內容取代目前插件設定。")
      .addButton((button) =>
        button.setButtonText(isEn ? "Export" : "匯出").onClick(async () => {
          try {
            await this.plugin.exportSettingsProfile();
            new Notice(isEn ? "Settings profile exported." : "已匯出設定配置檔。");
          } catch (error) {
            new CliOutputModal(this.app, isEn ? "Export failed" : "匯出失敗", String(error)).open();
          }
        })
      )
      .addButton((button) =>
        button.setButtonText(isEn ? "Import" : "載入").onClick(async () => {
          try {
            await this.plugin.importSettingsProfile();
            new Notice(isEn ? "Settings profile imported." : "已載入設定配置檔。");
            this.display();
          } catch (error) {
            new CliOutputModal(this.app, isEn ? "Import failed" : "載入失敗", String(error)).open();
          }
        })
      );

    containerEl.createEl("h3", { text: isEn ? "File actions" : "文件操作" });
    new Setting(containerEl)
      .setName(isEn ? "Use JSON output for file actions" : "文件操作使用 JSON Output")
      .setDesc(isEn ? "Asks the model to return JSON so create/edit actions are easier to parse." : "要求模型返回 JSON，讓創建/修改文件更容易解析。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useJsonOutputForActions).onChange(async (value) => {
          this.plugin.settings.useJsonOutputForActions = value;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(isEn ? "Confirm before applying file actions" : "套用文件操作前先確認")
      .setDesc(isEn ? "Recommended. Prevents AI from directly overwriting the current note." : "建議保持開啟，避免 AI 直接覆寫當前筆記。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.confirmBeforeApply).onChange(async (value) => {
          this.plugin.settings.confirmBeforeApply = value;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(isEn ? "Send DeepSeek thinking parameters" : "發送 DeepSeek thinking 參數")
      .setDesc(isEn ? "Available for DeepSeek V4. Turn this off if a custom proxy rejects these fields." : "DeepSeek V4 可用。若自定義代理不支援，可關閉。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.sendDeepSeekThinkingOptions).onChange(async (value) => {
          this.plugin.settings.sendDeepSeekThinkingOptions = value;
          await this.plugin.saveSettings();
        })
      );
  }

  renderAgent(containerEl: HTMLElement) {
    containerEl.createEl("h3", { text: "Autonomous Agent" });
    containerEl.createEl("p", { cls: "md-ai-writer-settings-note", text: "Toggle which tools the AI can use. Web/Search/YouTube/CLI are UI-ready placeholders; file tools are enforced by this plugin." });
    const panel = containerEl.createDiv({ cls: "md-ai-writer-agent-tools" });
    const tools: Array<[keyof Settings["agentTools"], string, string]> = [
      ["vaultSearch", "Vault Search", "Search through your vault notes"],
      ["webSearch", "Web Search", "Search the INTERNET when explicitly requested"],
      ["writeFile", "Write to File", "Create or rewrite files in your vault"],
      ["editFile", "Edit File", "Make targeted edits to an existing file"],
      ["youtubeTranscription", "YouTube Transcription", "Get transcripts from YouTube videos"],
      ["obsidianCli", "Obsidian CLI (Experimental)", "Enable direct vault operations via the Obsidian desktop CLI"]
    ];
    for (const [key, name, desc] of tools) {
      new Setting(panel)
        .setName(name)
        .setDesc(desc)
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.agentTools[key]).onChange(async (value) => {
            this.plugin.settings.agentTools[key] = value;
            await this.plugin.saveSettings();
          })
        );
    }

    containerEl.createEl("h3", { text: "Obsidian CLI" });
    new Setting(containerEl)
      .setName("CLI 路徑")
      .setDesc("通常填 obsidian。如果 PATH 未刷新，可填 Obsidian.com 的完整路徑。")
      .addText((text) =>
        text.setPlaceholder("obsidian").setValue(this.plugin.settings.obsidianCliPath).onChange(async (value) => {
          this.plugin.settings.obsidianCliPath = value.trim() || "obsidian";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Vault 名稱或路徑")
      .setDesc("可留空使用當前 Obsidian 上下文；如有多個 vault，建議填官方 CLI 支援的 vault 參數值。")
      .addText((text) =>
        text.setPlaceholder("My Vault").setValue(this.plugin.settings.obsidianCliVault).onChange(async (value) => {
          this.plugin.settings.obsidianCliVault = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("CLI timeout ms")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.obsidianCliTimeoutMs)).onChange(async (value) => {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed > 0) {
            this.plugin.settings.obsidianCliTimeoutMs = parsed;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName("測試 Obsidian CLI")
      .setDesc("執行 obsidian help，確認插件能調用 CLI。Obsidian app 需要正在運行。")
      .addButton((button) =>
        button.setButtonText("測試").onClick(async () => {
          try {
            const output = await execFileText(this.plugin.settings.obsidianCliPath || "obsidian", ["help"], this.plugin.settings.obsidianCliTimeoutMs);
            new CliOutputModal(this.app, "Obsidian CLI 測試成功", output).open();
          } catch (error) {
            new CliOutputModal(this.app, "Obsidian CLI 測試失敗", String(error)).open();
          }
        })
      );
  }

  renderProviderDetails(containerEl: HTMLElement, provider: ProviderId, title: string, customId?: string) {
    const isEn = this.plugin.settings.uiLanguage === "en";
    const details = containerEl.createEl("details", { cls: "md-ai-writer-settings-group" });
    details.open = provider === this.plugin.settings.provider && (provider === "deepseek" || customId === this.plugin.settings.activeCustomProviderId);
    details.createEl("summary", { text: title });
    const config = this.plugin.getProviderConfig(provider, customId);
    const customConfig = provider === "custom" ? this.plugin.getCustomProviderConfig(customId) : null;

    if (provider === "custom") {
      new Setting(details)
        .setName(isEn ? "Endpoint name" : "接口名稱")
        .setDesc(isEn ? "A local display name only. It helps you distinguish different API relay providers." : "只用於本地顯示，方便區分不同中轉商或自定義接口。")
        .addText((text) =>
          text
            .setPlaceholder(isEn ? "Custom endpoint" : "自定義接口")
            .setValue(customConfig?.name ?? "")
            .onChange(async (value) => {
              if (!customConfig) return;
              customConfig.name = value.trim() || (isEn ? "Custom endpoint" : "自定義接口");
              await this.plugin.saveSettings();
            })
        );

      new Setting(details)
        .setName(isEn ? "Use this endpoint" : "使用此接口")
        .setDesc(isEn ? "Make this the active custom endpoint for chat and file actions." : "將此接口設為目前對話與文件操作使用的自定義接口。")
        .addButton((button) =>
          button.setButtonText(customId === this.plugin.settings.activeCustomProviderId ? (isEn ? "Active" : "使用中") : (isEn ? "Use" : "使用")).onClick(async () => {
            if (!customId) return;
            this.plugin.settings.provider = "custom";
            this.plugin.settings.activeCustomProviderId = customId;
            await this.plugin.saveSettings();
            this.display();
          })
        );

      if (this.plugin.getCustomProviders().length > 1) {
        new Setting(details)
          .setName(isEn ? "Delete endpoint" : "刪除此接口")
          .setDesc(isEn ? "Only removes this local endpoint setting. It does not revoke the API key at the provider." : "只刪除此本地接口設定，不會撤銷供應商端的 API Key。")
          .addButton((button) =>
            button.setButtonText(isEn ? "Delete" : "刪除").onClick(async () => {
              if (!customId) return;
              this.plugin.settings.customProviders = this.plugin.getCustomProviders().filter((item) => item.id !== customId);
              if (this.plugin.settings.activeCustomProviderId === customId) {
                this.plugin.settings.activeCustomProviderId = this.plugin.getCustomProviders()[0]?.id ?? DEFAULT_CUSTOM_PROVIDER_ID;
              }
              await this.plugin.saveSettings();
              this.display();
            })
          );
      }
    }

    new Setting(details)
      .setName("API Key")
      .setDesc(provider === "deepseek" ? "DeepSeek API Key." : (isEn ? "API key for the custom endpoint." : "自定義接口的 API Key。"))
      .addText((text) =>
        text
          .setPlaceholder("sk-...")
          .setValue(config.apiKey)
          .onChange(async (value) => {
            config.apiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("Base URL")
      .setDesc(provider === "deepseek" ? "DeepSeek official URL: https://api.deepseek.com" : (isEn ? "OpenAI-compatible API base URL for this endpoint, usually ending in /v1." : "此接口的 OpenAI-compatible API Base URL，通常以 /v1 結尾。"))
      .addText((text) =>
        text
          .setPlaceholder(provider === "deepseek" ? "https://api.deepseek.com" : "https://provider.example/v1")
          .setValue(config.baseUrl)
          .onChange(async (value) => {
            config.baseUrl = normalizeProviderBaseUrl(value.trim());
            if (provider === "custom" && isPackyApiBaseUrl(config.baseUrl)) {
              config.apiMode = "chat_completions";
              config.omitSamplingParams = true;
            }
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName(isEn ? "API mode" : "API 模式")
      .setDesc(provider === "deepseek" ? (isEn ? "DeepSeek uses Chat Completions." : "DeepSeek 使用 Chat Completions。") : (isEn ? "Select the API format for this endpoint. Use Responses only when the provider docs explicitly require it." : "選擇此接口的 API 格式；只有供應商文檔明確要求時才使用 Responses。"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("chat_completions", "Chat Completions")
          .addOption("responses", "Responses")
          .setValue(config.apiMode)
          .onChange(async (value) => {
            config.apiMode = provider === "custom" && isPackyApiBaseUrl(config.baseUrl)
              ? "chat_completions"
              : (isProviderApiMode(value) ? value : DEFAULT_SETTINGS.providers[provider].apiMode);
            await this.plugin.saveSettings();
          })
      );

    if (provider === "custom") {
      new Setting(details)
        .setName(isEn ? "Compatibility mode" : "兼容模式")
        .setDesc(isEn ? "Omits temperature, top-p, and frequency penalty. Enable this if a relay endpoint returns 400 for sampling parameters." : "不發送 temperature、top-p、frequency penalty。若某個中轉接口因採樣參數返回 400，可開啟。")
        .addToggle((toggle) =>
          toggle.setValue(Boolean(config.omitSamplingParams)).onChange(async (value) => {
            config.omitSamplingParams = value;
            await this.plugin.saveSettings();
          })
        );
    }

    new Setting(details)
      .setName(isEn ? "Connection test" : "測試連線")
      .setDesc(isEn ? "Sends a tiny chat request using this provider and shows the resolved request URL." : "使用此 provider 發送一個很小的 chat 請求，並顯示實際請求 URL。")
      .addButton((button) =>
        button.setButtonText(isEn ? "Test" : "測試").onClick(async () => {
          try {
            const output = await this.plugin.testProviderConnection(provider, customId);
            new CliOutputModal(this.app, isEn ? "Connection succeeded" : "連線成功", output).open();
          } catch (error) {
            new CliOutputModal(this.app, isEn ? "Connection failed" : "連線失敗", String(error)).open();
          }
        })
      );

    new Setting(details)
      .setName(isEn ? "Model list" : "模型清單")
      .setDesc(isEn ? "One model per line. The chat panel and model picker use this list." : "每行一個模型，對話框和上方模型選單會使用這份清單。")
      .addTextArea((text) =>
        text.setValue(config.models).onChange(async (value) => {
          config.models = value;
          const options = this.plugin.getModelOptions(provider, customId);
          if (!options.includes(config.model)) config.model = options[0] ?? "";
          await this.plugin.saveSettings();
        })
      );

    new Setting(details)
      .setName(isEn ? "Default model" : "預設模型")
      .addDropdown((dropdown) => {
        const models = this.plugin.getModelOptions(provider, customId);
        if (!models.length) dropdown.addOption("", isEn ? "Fill in the model list first" : "請先填寫模型清單");
        for (const model of models) dropdown.addOption(model, model);
        return dropdown.setValue(config.model).onChange(async (value) => {
          config.model = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(details)
      .setName(isEn ? "Add model" : "新增模型")
      .setDesc(isEn ? "Add multiple model names under the same provider, then switch them in the chat panel or model picker." : "同一個 provider 可加入多個模型名稱，之後可在聊天界面或模型選單切換。")
      .addButton((button) =>
        button.setButtonText(isEn ? "Add" : "新增").onClick(() => {
          new PromptModal(this.app, isEn ? "Add model" : "新增模型", isEn ? "Enter a model name, such as deepseek-v4-flash or provider/model" : "輸入模型名稱，例如 deepseek-v4-flash 或 provider/model", async (model) => {
            const next = model.trim();
            if (!next) return;
            const models = this.plugin.getModelOptions(provider, customId);
            if (!models.includes(next)) config.models = [...models, next].join("\n");
            if (!config.model) config.model = next;
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
      );

    if (provider === "deepseek") {
      new Setting(details)
        .setName(isEn ? "Send DeepSeek thinking parameters" : "發送 DeepSeek thinking 參數")
        .setDesc(isEn ? "Available for DeepSeek V4. Turn this off if a custom proxy rejects these fields." : "DeepSeek V4 可用。若自定義代理不支援，可關閉。")
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.sendDeepSeekThinkingOptions).onChange(async (value) => {
            this.plugin.settings.sendDeepSeekThinkingOptions = value;
            await this.plugin.saveSettings();
            this.display();
          })
        );

      if (this.plugin.settings.sendDeepSeekThinkingOptions) {
        new Setting(details)
          .setName("DeepSeek thinking mode")
          .setDesc(isEn ? "When enabled, temperature is not sent." : "開啟後不會發送 temperature。")
          .addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.deepSeekThinkingEnabled).onChange(async (value) => {
              this.plugin.settings.deepSeekThinkingEnabled = value;
              await this.plugin.saveSettings();
              this.display();
            })
          );
      }

      if (this.plugin.settings.sendDeepSeekThinkingOptions && this.plugin.settings.deepSeekThinkingEnabled) {
        new Setting(details)
          .setName(isEn ? "Reasoning effort" : "推理強度")
          .setDesc(isEn ? "DeepSeek V4 supports high and max." : "DeepSeek V4 支援 high 和 max。")
          .addDropdown((dropdown) =>
            dropdown
              .addOption("high", "high")
              .addOption("max", "max")
              .setValue(this.plugin.settings.reasoningEffort)
              .onChange(async (value) => {
                this.plugin.settings.reasoningEffort = value as ReasoningEffort;
                await this.plugin.saveSettings();
              })
          );
      }
    }
  }
}

function normalizeSettings(raw: unknown): Settings {
  const saved = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings> & {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  const legacyCustom = {
    ...DEFAULT_SETTINGS.providers.custom,
    ...(saved.providers?.custom ?? {})
  };
  const customProviders = normalizeCustomProviders(saved.customProviders, legacyCustom, saved.activeCustomProviderId);
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    preferredChatMode: isChatMode(saved.preferredChatMode) ? saved.preferredChatMode : DEFAULT_SETTINGS.preferredChatMode,
    chatHistory: saved.chatHistory ?? DEFAULT_SETTINGS.chatHistory,
    quickPrompts: saved.quickPrompts?.length
      ? saved.quickPrompts
      : saved.suggestedPrompts
        ? parseSuggestedPrompts(saved.suggestedPrompts).map((prompt) => ({ name: prompt.title, prompt: prompt.body }))
        : DEFAULT_SETTINGS.quickPrompts,
    enableMemory: saved.enableMemory ?? DEFAULT_SETTINGS.enableMemory,
    memoryFilePath: saved.memoryFilePath ?? DEFAULT_SETTINGS.memoryFilePath,
    agentTools: {
      ...DEFAULT_SETTINGS.agentTools,
      ...(saved.agentTools ?? {})
    },
    obsidianCliPath: saved.obsidianCliPath ?? DEFAULT_SETTINGS.obsidianCliPath,
    obsidianCliVault: saved.obsidianCliVault ?? DEFAULT_SETTINGS.obsidianCliVault,
    obsidianCliTimeoutMs: saved.obsidianCliTimeoutMs ?? DEFAULT_SETTINGS.obsidianCliTimeoutMs,
    knowledgeFolders: Array.isArray(saved.knowledgeFolders) ? saved.knowledgeFolders.filter((folder) => typeof folder === "string") : DEFAULT_SETTINGS.knowledgeFolders,
    voyageApiKey: typeof saved.voyageApiKey === "string" ? saved.voyageApiKey : DEFAULT_SETTINGS.voyageApiKey,
    voyageRerankModel: typeof saved.voyageRerankModel === "string" ? saved.voyageRerankModel : DEFAULT_SETTINGS.voyageRerankModel,
    knowledgeMaxCandidates: clampNumber(saved.knowledgeMaxCandidates ?? DEFAULT_SETTINGS.knowledgeMaxCandidates, 10, 200, DEFAULT_SETTINGS.knowledgeMaxCandidates),
    knowledgeTopK: clampNumber(saved.knowledgeTopK ?? DEFAULT_SETTINGS.knowledgeTopK, 1, 20, DEFAULT_SETTINGS.knowledgeTopK),
    uiLanguage: isUiLanguage(saved.uiLanguage) ? saved.uiLanguage : DEFAULT_SETTINGS.uiLanguage,
    uiFontFamily: typeof saved.uiFontFamily === "string" && saved.uiFontFamily.trim() ? saved.uiFontFamily : DEFAULT_SETTINGS.uiFontFamily,
    settingsProfilePath: typeof saved.settingsProfilePath === "string" && saved.settingsProfilePath.trim() ? normalizeMarkdownPath(saved.settingsProfilePath) : DEFAULT_SETTINGS.settingsProfilePath,
    providers: {
      deepseek: {
        ...DEFAULT_SETTINGS.providers.deepseek,
        ...(saved.providers?.deepseek ?? {})
      },
      custom: stripCustomProvider(customProviders[0])
    },
    customProviders,
    activeCustomProviderId: customProviders.some((provider) => provider.id === saved.activeCustomProviderId) ? String(saved.activeCustomProviderId) : customProviders[0].id
  };

  if (saved.apiKey || saved.baseUrl || saved.model) {
    settings.providers.deepseek = {
      ...settings.providers.deepseek,
      apiKey: saved.apiKey ?? settings.providers.deepseek.apiKey,
      baseUrl: saved.baseUrl ?? settings.providers.deepseek.baseUrl,
      model: saved.model ?? settings.providers.deepseek.model
    };
  }

  if (settings.provider !== "deepseek" && settings.provider !== "custom") {
    settings.provider = "deepseek";
  }

  normalizeProviderConfig(settings.providers.deepseek, DEFAULT_SETTINGS.providers.deepseek);
  for (const config of settings.customProviders) normalizeProviderConfig(config, DEFAULT_SETTINGS.providers.custom);
  const activeCustom = settings.customProviders.find((provider) => provider.id === settings.activeCustomProviderId) ?? settings.customProviders[0];
  settings.activeCustomProviderId = activeCustom.id;
  settings.providers.custom = stripCustomProvider(activeCustom);

  settings.agentTools.writeFile = true;
  settings.agentTools.editFile = true;

  return settings;
}

function normalizeCustomProviders(raw: unknown, legacyCustom: ProviderConfig, activeId: unknown): CustomProviderConfig[] {
  const list = Array.isArray(raw) ? raw : [];
  const normalized = list
    .map((item, index) => createCustomProviderConfig(item as Partial<CustomProviderConfig>, typeof (item as any)?.id === "string" ? (item as any).id : `custom-${index + 1}`, typeof (item as any)?.name === "string" ? (item as any).name : `自定義接口 ${index + 1}`))
    .filter((provider) => provider.id.trim());
  if (!normalized.length) {
    normalized.push(createCustomProviderConfig(legacyCustom, typeof activeId === "string" && activeId.trim() ? activeId : DEFAULT_CUSTOM_PROVIDER_ID, "自定義接口 1"));
  }
  const used = new Set<string>();
  return normalized.map((provider, index) => {
    let id = provider.id.trim() || `custom-${index + 1}`;
    while (used.has(id)) id = `${id}-${index + 1}`;
    used.add(id);
    return { ...provider, id };
  });
}

function createCustomProviderConfig(config: Partial<ProviderConfig & { name?: string }> | undefined, id: string = createCustomProviderId(), name: string = "自定義接口"): CustomProviderConfig {
  return {
    id,
    name: (config?.name ?? name).trim() || name,
    apiKey: config?.apiKey ?? "",
    baseUrl: config?.baseUrl ?? "",
    model: config?.model ?? "",
    models: config?.models ?? "",
    apiMode: isProviderApiMode(config?.apiMode) ? config.apiMode : "chat_completions",
    omitSamplingParams: Boolean(config?.omitSamplingParams)
  };
}

function createCustomProviderId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function stripCustomProvider(config: CustomProviderConfig): ProviderConfig {
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    models: config.models,
    apiMode: config.apiMode,
    omitSamplingParams: config.omitSamplingParams
  };
}

function normalizeProviderConfig(config: ProviderConfig, fallback: ProviderConfig) {
  config.baseUrl = normalizeProviderBaseUrl(config.baseUrl ?? fallback.baseUrl);
  config.apiMode = isProviderApiMode(config.apiMode) ? config.apiMode : fallback.apiMode;
  if (isPackyApiBaseUrl(config.baseUrl)) {
    config.apiMode = "chat_completions";
    config.omitSamplingParams = true;
  }
  const options = (config.models ?? "")
    .split(/[\n,]/)
    .map((model) => model.trim())
    .filter(Boolean);
  if (config.model && !options.includes(config.model)) {
    config.models = [config.model, ...options].join("\n");
  } else {
    config.models = options.join("\n");
  }
}

function buildSettingsProfileMarkdown(settings: Settings): string {
  const payload = {
    version: 1,
    app: APP_NAME,
    exportedAt: new Date().toISOString(),
    settings: createSettingsProfile(settings)
  };
  return `# ${APP_NAME} Settings Profile

> This file contains API keys and local plugin settings. Do not publish or share it publicly.
> 這份文件包含 API Key 和本地插件設定，請勿公開或提交到公共倉庫。

Import/export format:

\`\`\`\`${SETTINGS_PROFILE_CODE_BLOCK}
${JSON.stringify(payload, null, 2)}
\`\`\`\`
`;
}

function createSettingsProfile(settings: Settings): Partial<Settings> {
  return {
    provider: settings.provider,
    providers: settings.providers,
    customProviders: settings.customProviders,
    activeCustomProviderId: settings.activeCustomProviderId,
    preferredChatMode: settings.preferredChatMode,
    temperature: settings.temperature,
    topP: settings.topP,
    frequencyPenalty: settings.frequencyPenalty,
    maxTokens: settings.maxTokens,
    systemPrompt: settings.systemPrompt,
    quickPrompts: settings.quickPrompts,
    enableMemory: settings.enableMemory,
    memoryFilePath: settings.memoryFilePath,
    agentTools: settings.agentTools,
    obsidianCliPath: settings.obsidianCliPath,
    obsidianCliVault: settings.obsidianCliVault,
    obsidianCliTimeoutMs: settings.obsidianCliTimeoutMs,
    useJsonOutputForActions: settings.useJsonOutputForActions,
    sendDeepSeekThinkingOptions: settings.sendDeepSeekThinkingOptions,
    deepSeekThinkingEnabled: settings.deepSeekThinkingEnabled,
    reasoningEffort: settings.reasoningEffort,
    confirmBeforeApply: settings.confirmBeforeApply,
    includeActiveNoteByDefault: settings.includeActiveNoteByDefault,
    knowledgeFolders: settings.knowledgeFolders,
    voyageApiKey: settings.voyageApiKey,
    voyageRerankModel: settings.voyageRerankModel,
    knowledgeMaxCandidates: settings.knowledgeMaxCandidates,
    knowledgeTopK: settings.knowledgeTopK,
    uiLanguage: settings.uiLanguage,
    uiFontFamily: settings.uiFontFamily,
    settingsProfilePath: settings.settingsProfilePath
  };
}

function parseSettingsProfileMarkdown(markdown: string): Partial<Settings> {
  const json = extractSettingsProfileJson(markdown);
  const parsed = JSON.parse(json) as { settings?: Partial<Settings> } & Partial<Settings>;
  const settings = parsed.settings ?? parsed;
  if (!settings || typeof settings !== "object") throw new Error("設定檔格式錯誤：找不到 settings 物件。");
  return settings;
}

function extractSettingsProfileJson(markdown: string): string {
  const fourBacktick = new RegExp("````" + SETTINGS_PROFILE_CODE_BLOCK + "\\s*([\\s\\S]*?)````", "i");
  const threeBacktick = new RegExp("```" + SETTINGS_PROFILE_CODE_BLOCK + "\\s*([\\s\\S]*?)```", "i");
  const jsonFence = /```json\s*([\s\S]*?)```/i;
  const matched = markdown.match(fourBacktick) ?? markdown.match(threeBacktick) ?? markdown.match(jsonFence);
  const raw = (matched?.[1] ?? markdown).trim();
  if (!raw.startsWith("{")) throw new Error(`設定檔格式錯誤：請使用 ${SETTINGS_PROFILE_CODE_BLOCK} JSON code block。`);
  return raw;
}

function isChatMode(value: unknown): value is ChatMode {
  return value === "chat" || value === "edit" || value === "knowledge" || value === "new";
}

function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "zh" || value === "en";
}

function isProviderApiMode(value: unknown): value is ProviderApiMode {
  return value === "chat_completions" || value === "responses";
}

function historyMatchesQuery(item: ChatHistoryItem, query: string): boolean {
  if (!query) return true;
  return [item.title, item.prompt, item.answer]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(query));
}

function uiText(settings: Settings, key: keyof typeof UI_TEXT.zh): string {
  return UI_TEXT[settings.uiLanguage ?? "zh"][key];
}

function modeLabel(settings: Settings, mode: ChatMode): string {
  if (mode === "chat") return uiText(settings, "modeChat");
  if (mode === "edit") return uiText(settings, "modeEdit");
  if (mode === "knowledge") return uiText(settings, "modeKnowledge");
  return uiText(settings, "modeNew");
}

function modeIcon(mode: ChatMode): string {
  if (mode === "chat") return "message-circle";
  if (mode === "edit") return "pencil";
  if (mode === "knowledge") return "search";
  return "file-plus";
}

function modeDescription(settings: Settings, mode: ChatMode): string {
  if (mode === "chat") return uiText(settings, "descChat");
  if (mode === "edit") return uiText(settings, "descEdit");
  if (mode === "knowledge") return uiText(settings, "descKnowledge");
  return uiText(settings, "descNew");
}

function shortModelName(model: string): string {
  const clean = model.trim();
  if (!clean) return model;
  const lastSegment = clean.split("/").filter(Boolean).pop() ?? clean;
  return lastSegment
    .replace(/^deepseek[-_]/i, "ds-")
    .replace(/^claude[-_]/i, "cl-")
    .replace(/^gpt[-_]/i, "gpt-")
    .replace(/[-_]instruct$/i, "")
    .replace(/[-_]chat$/i, "")
    .slice(0, 22);
}

function knowledgeModeTitle(settings: Settings): string {
  return settings.uiLanguage === "en" ? "Search" : "搜尋";
}

function knowledgeSummaryText(settings: Settings, folders: string[], hasVoyage: boolean): string {
  const scope = folders.length ? folders.join(", ") : uiText(settings, "allVault");
  const method = hasVoyage ? "Voyage" : uiText(settings, "localSearch");
  return `${scope} · ${method}`;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function chunkMarkdown(path: string, raw: string): KnowledgeChunk[] {
  const clean = stripFrontmatter(raw).replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const sections = clean.split(/(?=^#{1,6}\s+)/m).map((section) => section.trim()).filter(Boolean);
  const sourceSections = sections.length ? sections : [clean];
  const chunks: KnowledgeChunk[] = [];
  for (const section of sourceSections) {
    const title = extractSectionTitle(section) || path;
    for (const text of splitLongText(section, 1400, 160)) {
      chunks.push({ path, title, text, score: 0 });
    }
  }
  return chunks;
}

function extractSectionTitle(section: string): string {
  const firstLine = section.split("\n")[0]?.trim() ?? "";
  const heading = firstLine.match(/^#{1,6}\s+(.+)$/);
  return (heading?.[1] ?? "").trim();
}

function splitLongText(text: string, maxChars: number, overlap: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + maxChars);
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks.filter(Boolean);
}

function rankKnowledgeChunks(query: string, chunks: KnowledgeChunk[]): KnowledgeChunk[] {
  const terms = tokenizeForSearch(query);
  const compactQuery = query.toLowerCase().replace(/\s+/g, "");
  const intent = detectSearchIntent(query);
  return chunks
    .map((chunk) => {
      const haystack = `${chunk.path}\n${chunk.title}\n${chunk.text}`.toLowerCase();
      const compactHaystack = haystack.replace(/\s+/g, "");
      let score = compactQuery.length >= 4 && compactHaystack.includes(compactQuery) ? 20 : 0;
      const lowerPath = chunk.path.toLowerCase();
      const lowerTitle = chunk.title.toLowerCase();
      for (const term of terms) {
        if (!term) continue;
        const occurrences = countOccurrences(haystack, term);
        score += occurrences * Math.min(8, Math.max(1, term.length / 2));
        if (lowerPath.includes(term)) score += 5;
        if (lowerTitle.includes(term)) score += 7;
      }
      if (intent.inProgress && /(^|\/)進行中(\/|$)/.test(chunk.path)) score += 55;
      if (intent.work && /(^|\/|[0-9]\.\s*)工作(\/|$)/.test(chunk.path)) score += 18;
      if (intent.todo && /待辦|todo|任務|task/i.test(chunk.path)) score += 18;
      if (intent.project && /項目|專案|方案|project/i.test(`${chunk.path}\n${chunk.title}`)) score += 14;
      if (/封存|archive|已完成|完成|插件更新日誌|changelog|codex_handoff/i.test(chunk.path)) score -= intent.inProgress ? 45 : 18;
      if (isKnowledgeNoisePath(chunk.path)) score -= 100;
      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function detectSearchIntent(query: string) {
  const lower = query.toLowerCase();
  return {
    inProgress: /進行中|正在|目前|current|active|ongoing|in progress/.test(lower),
    work: /工作|項目|專案|project|work/.test(lower),
    todo: /待辦|任務|todo|task/.test(lower),
    project: /項目|專案|方案|project|initiative/.test(lower)
  };
}

function takeDiverseKnowledgeChunks(chunks: KnowledgeChunk[], limit: number, perPath: number): KnowledgeChunk[] {
  const result: KnowledgeChunk[] = [];
  const pathCounts = new Map<string, number>();
  const seenText = new Set<string>();
  for (const chunk of chunks) {
    const count = pathCounts.get(chunk.path) ?? 0;
    if (count >= perPath) continue;
    const fingerprint = chunk.text.replace(/\s+/g, "").slice(0, 220);
    if (fingerprint && seenText.has(fingerprint)) continue;
    seenText.add(fingerprint);
    pathCounts.set(chunk.path, count + 1);
    result.push(chunk);
    if (result.length >= limit) break;
  }
  return result;
}

function buildKnowledgeSearchQuery(prompt: string, context: string): string {
  if (!isFollowUpQuestion(prompt)) return prompt;
  const historyBlock = context.match(/<current_chat_history>\n([\s\S]*?)\n<\/current_chat_history>/)?.[1] ?? "";
  const matches = Array.from(historyBlock.matchAll(/User:\n([\s\S]*?)\n\nAssistant:/g));
  const lastUser = matches.at(-1)?.[1]?.trim();
  if (!lastUser) return prompt;
  return `${lastUser}\n${prompt}`;
}

function isFollowUpQuestion(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim();
  if (lower.length <= 12) return true;
  return /這|這個|剛才|上面|上一個|它|哪些|還有|that|this|previous|above|more/.test(lower);
}

function isCurrentModelQuestion(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  if (!/模型|model/.test(lower)) return false;
  if (!/回答|使用|用|目前|現在|剛才|這次|which|what|used|using|answer/.test(lower)) return false;
  return /這|剛才|這次|目前|現在|你|ai|answer|used|using|which|what/.test(lower);
}

function isKnowledgeNoisePath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.startsWith(".obsidian/")) return true;
  if (lower.includes("codex_handoff")) return true;
  if (path.includes("插件更新日誌")) return true;
  if (lower.endsWith("/readme.md") && lower.includes("md-ai-writer")) return true;
  return false;
}

function tokenizeForSearch(query: string): string[] {
  const lower = query.toLowerCase();
  const matches = lower.match(/[\p{Letter}\p{Number}_]{2,}/gu) ?? [];
  const terms = new Set(matches);
  const cjk = lower.match(/[\u3400-\u9fff]{2,}/g) ?? [];
  for (const phrase of cjk) {
    for (let i = 0; i < phrase.length - 1; i++) terms.add(phrase.slice(i, i + 2));
  }
  return Array.from(terms).slice(0, 80);
}

function countOccurrences(text: string, term: string): number {
  let count = 0;
  let index = text.indexOf(term);
  while (index !== -1) {
    count++;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

function parseSuggestedPrompts(raw: string): Array<{ title: string; body: string }> {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title, ...rest] = line.split("|");
      const body = rest.join("|").trim() || title.trim();
      return { title: title.trim(), body };
    });
}

function parseCliPlan(raw: string): { toolCalls: CliToolCall[]; answerWithoutTools?: string } {
  const clean = stripJsonFence(raw);
  const parsed = JSON.parse(clean) as { toolCalls?: CliToolCall[]; answerWithoutTools?: string };
  const toolCalls = (parsed.toolCalls ?? [])
    .filter((call) => isAllowedCliTool(call.tool) && call.args && typeof call.args === "object")
    .slice(0, 3);
  return { toolCalls, answerWithoutTools: parsed.answerWithoutTools };
}

function looksLikeFileAction(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  if (/(bullet-point summary|summarize|summary of|create a summary|總結|摘要)/i.test(lower) && !/(文件|文檔|筆記|note|file|md|markdown|寫入|保存|更新|修改|整理|格式化)/i.test(prompt)) {
    return false;
  }
  return /(修改|更改|補充|加入|新增|新建|建立|創建|寫入|覆寫|更新|插入|刪除|移除|整理|格式化|重排|改寫|保存到|save|write|edit|modify|create .*?(file|note|markdown|md)|append|insert|delete|update|rewrite|format|reformat|organize)/i.test(prompt);
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return raw;
  return raw.slice(end + 4).trimStart();
}

function sanitizeMemoryText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 600);
}

function escapeXmlAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function formatMemoryTime(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function isAllowedCliTool(tool: string): tool is CliToolName {
  return ["search", "read", "tasks", "tags", "unresolved", "daily", "files"].includes(tool);
}

function sanitizeCliArgs(args: Record<string, string | boolean | number>): Record<string, string | boolean | number> {
  const allowed = new Set(["query", "path", "file", "limit", "format", "vault", "status", "tag", "folder", "sort", "order", "date"]);
  const safe: Record<string, string | boolean | number> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (!allowed.has(key)) continue;
    if (typeof value === "string") safe[key] = value.slice(0, 1000);
    if (typeof value === "number" && Number.isFinite(value)) safe[key] = Math.max(0, Math.min(value, 5000));
    if (typeof value === "boolean") safe[key] = value;
  }
  if (!safe.format) safe.format = "json";
  return safe;
}

function execFileText(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (Platform.isMobile) {
      reject(new Error("Obsidian CLI 只支援桌面端，手機端不能使用 child_process。"));
      return;
    }
    let execFile: ExecFileFn | undefined;
    try {
      execFile = require("child_process").execFile;
    } catch (error) {
      reject(new Error(`目前環境不支援 child_process：${String(error)}`));
      return;
    }
    if (!execFile) {
      reject(new Error("目前環境不支援 child_process.execFile。"));
      return;
    }
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}${stderr ? `\n${stderr}` : ""}`));
        return;
      }
      resolve((stdout || stderr || "").trim());
    });
  });
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json|file-action)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function normalizeProviderBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "");
    if ((host === "www.packyapi.com" || host === "packyapi.com") && (path === "" || path === "/")) {
      url.pathname = "/v1";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/+$/, "");
    }
    if (host === "docs.packyapi.com") return PACKYAPI_BASE_URL;
    return trimmed;
  } catch {
    return trimmed;
  }
}

function isPackyApiBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(normalizeProviderBaseUrl(baseUrl));
    return url.hostname.toLowerCase() === "www.packyapi.com" || url.hostname.toLowerCase() === "packyapi.com";
  } catch {
    return false;
  }
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = normalizeProviderBaseUrl(baseUrl).replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/responses")) return `${trimmed.replace(/\/responses$/, "")}/chat/completions`;
  return `${trimmed}/chat/completions`;
}

function responsesUrl(baseUrl: string): string {
  const trimmed = normalizeProviderBaseUrl(baseUrl).replace(/\/+$/, "");
  if (trimmed.endsWith("/responses")) return trimmed;
  if (trimmed.endsWith("/chat/completions")) return `${trimmed.replace(/\/chat\/completions$/, "")}/responses`;
  return `${trimmed}/responses`;
}

function effectiveProviderApiMode(config: ProviderConfig): ProviderApiMode {
  if (isPackyApiBaseUrl(config.baseUrl)) return "chat_completions";
  return isProviderApiMode(config.apiMode) ? config.apiMode : "chat_completions";
}

function shouldSendSamplingOptions(config: ProviderConfig): boolean {
  return !config.omitSamplingParams && !isPackyApiBaseUrl(config.baseUrl);
}

function providerRequestUrl(config: ProviderConfig): string {
  return effectiveProviderApiMode(config) === "responses" ? responsesUrl(config.baseUrl) : chatCompletionsUrl(config.baseUrl);
}

function ensureJsonModeUserPrompt(messages: ChatMessage[]): ChatMessage[] {
  if (messages.some((message) => message.role !== "system" && /\bjson\b/i.test(message.content))) {
    return messages;
  }
  const clone = messages.map((message) => ({ ...message }));
  for (let i = clone.length - 1; i >= 0; i--) {
    if (clone[i].role === "system") continue;
    clone[i] = {
      ...clone[i],
      content: `${clone[i].content}\n\nReturn valid JSON.`
    };
    return clone;
  }
  return [...clone, { role: "user", content: "Return valid JSON." }];
}

function responsesRequestBody(messages: ChatMessage[], model: string, maxTokens: number): Record<string, unknown> {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const input = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content
    }));
  return {
    model,
    instructions: instructions || undefined,
    input: input.length ? input : "connection test",
    max_output_tokens: maxTokens,
    stream: false
  };
}

function parseAiJsonResponse(text: string, url: string): unknown {
  const trimmed = text.trim();
  if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    throw new Error(
      `AI provider returned HTML, not JSON. The Base URL is probably a website page instead of an API endpoint.\n` +
      `Request URL: ${url}\n` +
      `Use the provider's API base URL, usually ending in /v1.`
    );
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`AI provider returned non-JSON response from ${url}: ${String(error)}\n${trimmed.slice(0, 500)}`);
  }
}

function extractChatCompletionsContent(json: unknown): string | undefined {
  const response = json as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> };
  const first = response.choices?.[0];
  return extractTextValue(first?.message?.content) ?? extractTextValue(first?.text);
}

function extractResponsesContent(json: unknown): string | undefined {
  const response = json as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: unknown; type?: string; content?: unknown }> }>;
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
    content?: unknown;
  };
  if (typeof response.output_text === "string") return response.output_text;
  const chatContent = extractChatCompletionsContent(json);
  if (chatContent) return chatContent;
  const direct = extractTextValue(response.content);
  if (direct) return direct;
  const parts: string[] = [];
  for (const output of response.output ?? []) {
    for (const content of output.content ?? []) {
      const text = extractTextValue(content.text) ?? extractTextValue(content.content);
      if (text) parts.push(text);
    }
  }
  return parts.join("\n").trim() || undefined;
}

function extractTextValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map(extractTextValue).filter((part): part is string => Boolean(part));
    return parts.join("\n").trim() || undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return extractTextValue(record.text) ?? extractTextValue(record.value) ?? extractTextValue(record.content);
  }
  return undefined;
}

function summarizeAiResponse(json: unknown): string {
  try {
    return `Response summary: ${JSON.stringify(redactLargeResponse(json)).slice(0, 1200)}`;
  } catch {
    return "Response summary unavailable.";
  }
}

function redactLargeResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 5).map(redactLargeResponse);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>).slice(0, 25)) {
      if (/key|token|authorization/i.test(key)) continue;
      output[key] = redactLargeResponse(inner);
    }
    return output;
  }
  return typeof value === "string" ? value.slice(0, 500) : value;
}

function parseActions(raw: string): FileAction[] {
  const blocks = extractActionJsonBlocks(raw);
  const actions: FileAction[] = [];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block) as Partial<{ actions: FileAction[] }> & Partial<FileAction>;
      if (Array.isArray(parsed.actions)) actions.push(...parsed.actions);
      else if (typeof parsed.action === "string" && typeof parsed.content === "string") actions.push(parsed as FileAction);
    } catch {
      continue;
    }
  }
  return actions.filter((action) => action.action && typeof action.content === "string");
}

function extractActionJsonBlocks(raw: string): string[] {
  const blocks: string[] = [];
  const fencePattern = /```(?:json|file-action)\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(raw)) !== null) {
    if (match[1]?.trim()) blocks.push(match[1].trim());
  }
  if (!blocks.length) blocks.push(stripJsonFence(raw));
  return blocks;
}

function normalizeMarkdownPath(path: string): string {
  const normalized = normalizePath(path.trim());
  return normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
}

async function ensureFolder(app: App, filePath: string) {
  const parts = filePath.split("/").slice(0, -1);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}
