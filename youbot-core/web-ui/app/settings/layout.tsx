import { SettingsSectionNav } from "@/components/settings-section-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="settings-shell">
      <aside className="settings-rail" aria-label="Settings navigation">
        <SettingsSectionNav />
      </aside>
      <main className="settings-main">
        <div className="settings-mobile-nav">
          <SettingsSectionNav mobile />
        </div>
        {children}
      </main>
    </div>
  );
}
