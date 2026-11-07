import { Chats } from "@phosphor-icons/react";
import SidebarItem from "../../components/AppShell/SidebarItem";
import { useI18n } from "../../i18n";
import { useUnreadState } from "./UnreadStateBridge";
import { UnreadBadge } from "./UnreadBadge";

/** Navigation to every unread thread, including workspaces outside the Recent list. */
export const UnreadSummary = ({ collapsed }: { collapsed: boolean }) => {
  const { t } = useI18n();
  const unread = useUnreadState();
  return (
    <SidebarItem
      to="/unread"
      label={t('Unread threads')}
      icon={<Chats size={14} weight="regular" />}
      trailing={<UnreadBadge count={unread?.state?.unreadMessageCount ?? 0} />}
      collapsed={collapsed}
    />
  );
};
