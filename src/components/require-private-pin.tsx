import { useState, type ReactNode } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Field, Modal } from "@/components/ui-elements";
import { useProfile, useSignOut } from "@/hooks";
import { changeOwnPin, refreshSessionProfile } from "@/lib/lms";

/** Hold portal content until every role has replaced an issued temporary PIN. */
export function RequirePrivatePin({ children }: { children: ReactNode }) {
  const profile = useProfile();
  if (!profile) return null;
  return profile.pin_must_change ? <PinChangeGate /> : children;
}

/**
 * Blocking forced-PIN-change gate. Same form pattern as the settings
 * "Reset Account PIN" section (Field + plain form), minus the current-PIN
 * field — the signed-in session is the identity proof here. onClose is a
 * no-op: the gate only clears once the change succeeds.
 */
function PinChangeGate() {
  const signOut = useSignOut();
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!/^\d{4,8}$/.test(newPin)) {
      toast.error("New PIN must be 4–8 digits");
      return;
    }
    if (newPin !== confirmPin) {
      toast.error("New PINs do not match");
      return;
    }
    setBusy(true);
    try {
      await changeOwnPin(null, newPin);
      // Re-fetch the session profile (pin_must_change cleared server-side) —
      // the gate closes as soon as the refreshed profile lands in the store.
      await refreshSessionProfile();
      toast.success("PIN updated successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update PIN");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open hideClose onClose={() => {}} title="Choose a new PIN">
      <form
        data-testid="pin-gate"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void submit();
        }}
      >
        <p className="mb-4 text-sm text-muted-foreground">
          Replace your temporary PIN with a private PIN of 4–8 digits before continuing.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="New PIN"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            maxLength={8}
            data-testid="pin-gate-new"
          />
          <Field
            label="Confirm new PIN"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            maxLength={8}
            data-testid="pin-gate-confirm"
          />
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={signOut}
            disabled={busy}
            className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:bg-muted"
          >
            Sign out
          </button>
          <button
            type="submit"
            disabled={busy || !newPin || !confirmPin}
            data-testid="pin-gate-submit"
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lift transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <KeyRound className="h-4 w-4" /> {busy ? "Saving…" : "Set PIN"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
