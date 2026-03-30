import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CreditCard, Plus, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BuyCreditsDialog } from "./BuyCreditsDialog";

export function CreditBalance() {
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [showBuyDialog, setShowBuyDialog] = useState(false);

  useEffect(() => {
    loadBalance();
  }, []);

  const loadBalance = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('credit_balance')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      setBalance(data?.credit_balance || 0);
    } catch (error) {
      console.error('Error loading credit balance:', error);
    } finally {
      setLoading(false);
    }
  };

  const isLowBalance = balance < 5;

  return (
    <>
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <CreditCard className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Credit Balance</h3>
              <p className="text-sm text-muted-foreground">Available credits</p>
            </div>
          </div>
        </div>

        <div className="flex items-end justify-between">
          <div>
            {loading ? (
              <div className="h-12 w-32 bg-muted/20 rounded animate-pulse" />
            ) : (
              <div className="font-display text-5xl font-bold text-gradient">
                {balance.toFixed(1)}
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              credits remaining
            </p>
          </div>

          <Button
            variant="hero"
            size="lg"
            onClick={() => setShowBuyDialog(true)}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Buy Credits
          </Button>
        </div>

        {isLowBalance && (
          <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-500">
              <TrendingUp className="w-4 h-4" />
              <p className="text-sm font-medium">
                Low balance! Purchase more credits to continue using Vribble.
              </p>
            </div>
          </div>
        )}
      </div>

      <BuyCreditsDialog
        open={showBuyDialog}
        onOpenChange={setShowBuyDialog}
        onSuccess={loadBalance}
      />
    </>
  );
}
