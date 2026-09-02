import { Icon } from "./Icon";
import { PanelHead } from "./IntegrationsView";

/**
 * Placeholder surface for Greenboat monitoring.
 * The page shell is intentionally ready for the future listener configuration and event feed.
 */
export function GreenboatView() {
  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-paper hairline-scroll">
      <div className="max-w-4xl mx-auto px-7 py-6">
        <PanelHead
          title="绿舟监听"
          sub="集中查看和管理绿舟的监听状态。"
        />

        <section className="rounded-xl border border-line bg-panel p-6" data-testid="greenboat-placeholder">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-lg bg-accentSoft text-accent grid place-items-center shrink-0">
              <Icon name="radio" size={19} />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold text-ink">监听功能即将上线</h3>
              <p className="text-[13px] text-muted mt-1 leading-relaxed">
                这里将展示绿舟监听源、连接状态和最近收到的事件。
              </p>
              <span className="inline-flex items-center gap-1.5 mt-4 text-[12px] text-faint">
                <span className="w-1.5 h-1.5 rounded-full bg-faint" />
                尚未配置监听源
              </span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
