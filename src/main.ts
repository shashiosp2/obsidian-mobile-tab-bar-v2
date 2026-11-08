import {
  Plugin,
  PluginSettingTab,
  Setting,
  FileView,
  Platform,
  WorkspaceLeaf,
  type App,
  type ViewState,
  type SettingDefinitionItem,
} from 'obsidian';

interface MobileTabBarSettings {
  closeOnLongPress: boolean;
  closeOnSwipeUp: boolean;
}

const DEFAULT_SETTINGS: MobileTabBarSettings = {
  closeOnLongPress: true,
  closeOnSwipeUp: false,
};

export default class MobileTabBar extends Plugin {
  settings: MobileTabBarSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new MobileTabBarSettingTab(this.app, this));
    if (Platform.isMobile) this.setupTabBar();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MobileTabBarSettings>);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private setupTabBar() {
    const bar = createDiv({ cls: 'mtb-tab-bar' });
    const dot = createSpan({ cls: 'mtb-save-dot' });
    let longPressTimer: number | null = null;
    let startX = 0;
    let startY = 0;
    let isSwiping = false;

    const cancelLongPress = () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const getLeafPath = (leaf: WorkspaceLeaf): string | undefined => {
      if (leaf.view instanceof FileView && leaf.view.file) return leaf.view.file.path;
      const state = leaf.getViewState()?.state as ViewState | undefined;
      return (state as Record<string, unknown> | undefined)?.file as string | undefined;
    };

    const getLeafName = (leaf: WorkspaceLeaf): string | undefined => {
      if (leaf.view instanceof FileView && leaf.view.file) return leaf.view.file.basename;
      const path = getLeafPath(leaf);
      return path ? path.split('/').pop()?.replace(/\.md$/, '') : undefined;
    };

    const getLeaves = () => {
      const seen = new Set<string>();
      const leaves: WorkspaceLeaf[] = [];
      const root = this.app.workspace.rootSplit;
      this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
        if (root && leaf.getRoot() !== root) return;
        const path = getLeafPath(leaf);
        if (path && !seen.has(path)) {
          seen.add(path);
          leaves.push(leaf);
        }
      });
      return leaves;
    };

    // optional: reads autosave-control plugin's DOM class to show save state
    // dot hidden by default, only shown once autosave-control state is known
    const syncDot = () => {
      const icon = activeDocument.querySelector('.save-status-icon');
      if (icon) {
        const pending = icon.classList.contains('asc-pending');
        dot.classList.toggle('mtb-save-pending', pending);
        dot.classList.toggle('mtb-save-ok', !pending);
      }
    };

    const rebuild = () => {
      bar.empty();
      const active = this.app.workspace.getMostRecentLeaf();
      const leaves = getLeaves();

      for (const leaf of leaves) {
        const name = getLeafName(leaf);
        if (!name) continue;
        const tab = createSpan({ cls: 'mtb-tab', text: name });
        if (leaf === active) {
          tab.addClass('mtb-tab-active');
          tab.appendChild(dot);
          syncDot();
        }

        tab.addEventListener('touchstart', (e: TouchEvent) => {
          cancelLongPress();
          isSwiping = false;
          const touch = e.touches[0];
          if (touch) {
            startX = touch.clientX;
            startY = touch.clientY;
          }

          if (this.settings.closeOnLongPress) {
            longPressTimer = window.setTimeout(() => {
              longPressTimer = null;
              leaf.detach();
              rebuild();
            }, 500);
          }
        });

        tab.addEventListener('touchmove', (e: TouchEvent) => {
          const touch = e.touches[0];
          if (!touch) return;
          const deltaX = touch.clientX - startX;
          const deltaY = touch.clientY - startY;

          // If moved horizontally or vertically beyond threshold, cancel long press
          if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
            cancelLongPress();
          }

          if (this.settings.closeOnSwipeUp && deltaY < -30 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
            isSwiping = true;
          }
        });

        tab.addEventListener('touchend', () => {
          if (isSwiping && this.settings.closeOnSwipeUp) {
            isSwiping = false;
            cancelLongPress();
            leaf.detach();
            rebuild();
            return;
          }

          if (this.settings.closeOnLongPress) {
            if (longPressTimer !== null) {
              cancelLongPress();
              this.app.workspace.setActiveLeaf(leaf);
            }
          } else {
            this.app.workspace.setActiveLeaf(leaf);
          }
        });

        tab.addEventListener('touchcancel', () => {
          cancelLongPress();
          isSwiping = false;
        });

        bar.appendChild(tab);
      }

      const activeTab = bar.querySelector('.mtb-tab-active');
      if (activeTab) window.setTimeout(() => activeTab.scrollIntoView({ inline: 'center', block: 'nearest' }), 0);
    };

    const attachBar = () => {
      const view = this.app.workspace.getActiveViewOfType(FileView);
      if (!view) return;
      const container = view.containerEl;
      const titleContainer = container.querySelector<HTMLElement>('.view-header-title-container');
      if (titleContainer) {
        titleContainer.hide();
        titleContainer.classList.add('mtb-hidden');
        const header = container.querySelector('.view-header');
        if (header && !header.contains(bar)) {
          if (bar.parentElement) bar.remove();
          const actions = header.querySelector('.view-actions');
          if (actions) header.insertBefore(bar, actions);
          else header.appendChild(bar);
        }
      }
    };

    const refresh = () => { attachBar(); rebuild(); };

    const obs = new MutationObserver(syncDot);
    const startObserving = (retries = 10) => {
      const icon = activeDocument.querySelector('.save-status-icon');
      if (icon) {
        obs.observe(icon, { attributes: true, attributeFilter: ['class'] });
        syncDot();
      } else if (retries > 0) {
        window.setTimeout(() => startObserving(retries - 1), 500);
      }
    };

    this.registerEvent(this.app.workspace.on('active-leaf-change', refresh));
    this.registerEvent(this.app.workspace.on('layout-change', refresh));
    this.registerEvent(this.app.workspace.on('file-open', refresh));

    this.app.workspace.onLayoutReady(() => {
      window.setTimeout(refresh, 500);
      startObserving();
    });

    this.register(() => {
      obs.disconnect();
      bar.remove();
      activeDocument.querySelectorAll<HTMLElement>('.mtb-hidden').forEach(el => {
        el.show();
        el.classList.remove('mtb-hidden');
      });
    });
  }
}

class MobileTabBarSettingTab extends PluginSettingTab {
  plugin: MobileTabBar;

  constructor(app: App, plugin: MobileTabBar) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'Swipe up to close tab',
        desc: 'Swipe up on a tab in the mobile tab bar to close it.',
        control: {
          type: 'toggle',
          key: 'closeOnSwipeUp',
          defaultValue: DEFAULT_SETTINGS.closeOnSwipeUp,
        },
      },
      {
        name: 'Long-press to close tab',
        desc: 'Long-press on a tab in the mobile tab bar to close it.',
        control: {
          type: 'toggle',
          key: 'closeOnLongPress',
          defaultValue: DEFAULT_SETTINGS.closeOnLongPress,
        },
      },
    ];
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Swipe up to close tab')
      .setDesc('Swipe up on a tab in the mobile tab bar to close it.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.closeOnSwipeUp)
          .onChange(async (value) => {
            this.plugin.settings.closeOnSwipeUp = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Long-press to close tab')
      .setDesc('Long-press on a tab in the mobile tab bar to close it.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.closeOnLongPress)
          .onChange(async (value) => {
            this.plugin.settings.closeOnLongPress = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
