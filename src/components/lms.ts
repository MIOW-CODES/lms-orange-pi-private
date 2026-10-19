/**
 * @deprecated Barrel re-export kept for backward compatibility only.
 * New code should import directly from the specific module.
 */

export { useProfile, useSignOut, useTheme, useRfidScanner } from "@/hooks";

export {
  ThemeToggle,
  Badge,
  Card,
  MotionCard,
  FadeIn,
  ProgressBar,
  EmptyState,
  LoadError,
  FilterTabs,
  Modal,
  Field,
  SelectField,
  Toggle,
} from "@/components/ui-elements";

export {
  type NavItem,
  STUDENT_NAV,
  ADMIN_NAV,
  TEACHER_NAV,
  staffNav,
  settingsPathFor,
  AppShell,
} from "@/components/sidebar";

export { attendanceTone, courseStyle, COURSE_STYLE } from "@/lib/ui-styles";
