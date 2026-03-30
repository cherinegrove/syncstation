import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Loader2, CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price_cents: number;
  price_per_credit_cents: number;
  savings_percent: number;
  is_popular: boolean;
  badge: string | null;
}

interface BuyCreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function BuyCreditsDialog({ open, onOpenChange, onSuccess }: BuyCreditsDialogProps) {
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);

  // Load packages when dialog opens
  useEffect(() => {
    if (open) {
      loadPackages();
    }
  }, [open]);

  const loadPackages = async () => {
    const { data, error } = await supabase
      .from('credit_packages')
      .select('*')
      .eq('is_active', true)
      .order('display_order');

    if (error) {
      console.error('Error loading packages:', error);
      toast.error('Failed to load credit packages');
      return;
    }

    setPackages(data || []);
  };

  const handlePurchase = async (packageId: string) => {
    setLoading(true);
    setSelectedPackage(packageId);

    try {
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: { packageId },
      });

      if (error) throw error;

      if (data.url) {
        // Redirect to Stripe checkout
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Error creating checkout session:', error);
      toast.error('Failed to start checkout. Please try again.');
      setLoading(false);
      setSelectedPackage(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-bold">
            Buy Credits
          </DialogTitle>
          <p className="text-muted-foreground">
            Credits never expire. Use them whenever you need them.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mt-6">
          {packages.map((pkg) => (
            <CreditPackageCard
              key={pkg.id}
              package={pkg}
              onSelect={() => handlePurchase(pkg.id)}
              isLoading={loading && selectedPackage === pkg.id}
              disabled={loading}
            />
          ))}
        </div>

        <div className="mt-6 p-4 glass rounded-lg bg-muted/20">
          <h3 className="font-semibold text-sm mb-2">What's Included</h3>
          <div className="grid md:grid-cols-2 gap-2 text-sm text-muted-foreground">
            <IncludedFeature text="All features included" />
            <IncludedFeature text="Credits never expire" />
            <IncludedFeature text="AI-generated emails" />
            <IncludedFeature text="Personal + group scheduling" />
            <IncludedFeature text="Full transcripts" />
            <IncludedFeature text="Optional video recording" />
            <IncludedFeature text="All integrations" />
            <IncludedFeature text="Unlimited meeting history" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreditPackageCard({
  package: pkg,
  onSelect,
  isLoading,
  disabled,
}: {
  package: CreditPackage;
  onSelect: () => void;
  isLoading: boolean;
  disabled: boolean;
}) {
  const price = (pkg.price_cents / 100).toFixed(2);
  const pricePerCredit = (pkg.price_per_credit_cents / 100).toFixed(2);

  return (
    <div
      className={`relative glass rounded-xl p-4 ${
        pkg.is_popular ? 'border-primary/50 shadow-glow' : ''
      }`}
    >
      {pkg.badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
          <span className="bg-gradient-primary text-primary-foreground text-xs font-medium px-3 py-1 rounded-full">
            {pkg.badge}
          </span>
        </div>
      )}

      <div className="text-center mb-3">
        <div className="font-display text-3xl font-bold text-gradient mb-1">
          {pkg.credits}
        </div>
        <p className="text-xs text-muted-foreground">credits</p>
      </div>

      <div className="text-center mb-3">
        <div className="font-display text-2xl font-bold text-foreground">
          ${price}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          ${pricePerCredit}/credit
        </p>
      </div>

      {pkg.savings_percent > 0 && (
        <div className="text-center mb-3">
          <span className="inline-block px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
            Save {pkg.savings_percent}%
          </span>
        </div>
      )}

      <Button
        variant={pkg.is_popular ? "hero" : "outline"}
        className="w-full gap-2"
        size="sm"
        onClick={onSelect}
        disabled={disabled}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <CreditCard className="w-4 h-4" />
            Buy Now
          </>
        )}
      </Button>
    </div>
  );
}

function IncludedFeature({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
        <Check className="w-2.5 h-2.5 text-primary" />
      </div>
      <span>{text}</span>
    </div>
  );
}
