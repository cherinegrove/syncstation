import { Button } from "@/components/ui/button";
import { Star, ArrowRight } from "lucide-react";
import heroAstronaut from "@/assets/hero-astronaut.png";
import { Link } from "react-router-dom";

const HeroSection = () => {
  return (
    <section className="relative min-h-screen pt-32 pb-20 overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 starfield" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-glow opacity-50" />
      
      <div className="container mx-auto px-4 lg:px-8 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <div className="space-y-8 animate-fade-in">
            <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-bold leading-tight">
              <span className="text-gradient">Stop paying</span>
              <br />
              <span className="text-foreground">for meetings</span>
              <br />
              <span className="text-foreground">you don't have</span>
            </h1>
            
            <p className="text-xl text-muted-foreground max-w-lg">
              No monthly subscription. No wasted money. Just buy credits and use them when you need them.
            </p>

            {/* Pricing Display */}
            <div className="glass rounded-2xl p-6 max-w-lg border-primary/20">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Transcript-only</div>
                  <div className="font-display text-3xl font-bold text-gradient">$0.34</div>
                  <div className="text-xs text-muted-foreground">per meeting</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-1">With video</div>
                  <div className="font-display text-3xl font-bold text-gradient">$1.00</div>
                  <div className="text-xs text-muted-foreground">per meeting</div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <Link to="/auth">
                <Button variant="hero" size="xl" className="gap-2">
                  Buy 25 Credits - $20
                  <ArrowRight className="w-5 h-5" />
                </Button>
              </Link>
              <Link to="/auth">
                <Button variant="glass" size="xl">
                  Start 14-Day Trial
                </Button>
              </Link>
            </div>

            <p className="text-sm text-muted-foreground">
              Credits never expire • No monthly commitment • Cancel anytime
            </p>
          </div>

          {/* Right Content - Hero Image */}
          <div className="relative animate-float">
            <div className="absolute inset-0 bg-gradient-glow scale-150 opacity-30" />
            <img 
              src={heroAstronaut} 
              alt="AI Meeting Assistant - Pay per meeting"
              className="relative z-10 w-full max-w-2xl mx-auto drop-shadow-2xl"
            />
          </div>
        </div>

        {/* Value Props */}
        <div className="mt-16 animate-slide-up delay-300">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ValueProp 
              icon={<NoSubscriptionIcon />}
              label="No Subscription Waste"
              sublabel="Pay only for meetings you have"
            />
            <ValueProp 
              icon={<NeverExpireIcon />}
              label="Credits Never Expire"
              sublabel="Use them whenever you need"
            />
            <ValueProp 
              icon={<TransparentIcon />}
              label="Transparent Pricing"
              sublabel="We show you our actual costs"
            />
          </div>
        </div>
      </div>
    </section>
  );
};


const ValueProp = ({ 
  icon, 
  label, 
  sublabel 
}: { 
  icon: React.ReactNode; 
  label: string; 
  sublabel: string;
}) => (
  <div className="glass rounded-xl px-6 py-4 flex items-center gap-3 hover:border-primary/30 transition-all cursor-default">
    <div className="flex-shrink-0">{icon}</div>
    <div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground">{sublabel}</p>
    </div>
  </div>
);

const NoSubscriptionIcon = () => (
  <svg className="w-8 h-8 text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10"/>
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
  </svg>
);

const NeverExpireIcon = () => (
  <svg className="w-8 h-8 text-magenta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
  </svg>
);

const TransparentIcon = () => (
  <svg className="w-8 h-8 text-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
  </svg>
);

export default HeroSection;
