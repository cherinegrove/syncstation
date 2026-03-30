import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const steps = [
  {
    number: "01",
    title: "Buy credits when you need them",
    description: "No subscription. No commitment. Just purchase credits and they never expire. Buy 25 credits for $20 and use them whenever.",
  },
  {
    number: "02",
    title: "Choose transcript or video per meeting",
    description: "Important client call? Add video (1 credit). Quick status update? Transcript-only (0.34 credits). You control the cost every time.",
  },
  {
    number: "03",
    title: "Get AI-generated follow-up email instantly",
    description: "Professional recap with action items, talking points, and decisions. Copy-paste ready in 30 seconds. Your clients will love it.",
  },
];

const HowItWorksSection = () => {
  return (
    <section id="how-it-works" className="py-24 relative">
      <div className="container mx-auto px-4 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full bg-magenta/10 text-magenta text-sm font-medium mb-4">
            How It Works
          </span>
          <h2 className="font-display text-4xl md:text-5xl font-bold mb-6">
            Three steps to
            <span className="text-gradient"> better meetings</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            No complicated setup. No monthly bills. Just pay for what you use.
          </p>
        </div>

        {/* Steps */}
        <div className="relative max-w-4xl mx-auto">
          {/* Connection Line */}
          <div className="absolute left-8 md:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-cyan via-magenta to-purple hidden md:block" />
          
          <div className="space-y-12">
            {steps.map((step, index) => (
              <StepCard key={index} {...step} index={index} />
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="mt-16 text-center">
          <Link to="/auth">
            <Button variant="hero" size="xl">
              Start 14-Day Trial - 20 Credits Free
            </Button>
          </Link>
          <p className="mt-4 text-sm text-muted-foreground">
            No credit card required • Credits never expire
          </p>
        </div>
      </div>
    </section>
  );
};

const StepCard = ({ 
  number, 
  title, 
  description,
  index 
}: { 
  number: string; 
  title: string; 
  description: string;
  index: number;
}) => (
  <div className={`relative flex items-center gap-8 ${index % 2 === 1 ? 'md:flex-row-reverse' : ''}`}>
    {/* Number Badge */}
    <div className="absolute left-0 md:left-1/2 md:-translate-x-1/2 w-16 h-16 rounded-full bg-gradient-primary flex items-center justify-center z-10 shadow-glow">
      <span className="font-display font-bold text-xl text-primary-foreground">{number}</span>
    </div>
    
    {/* Content Card */}
    <div className={`ml-24 md:ml-0 md:w-[calc(50%-4rem)] glass rounded-2xl p-8 ${index % 2 === 1 ? 'md:mr-auto' : 'md:ml-auto'}`}>
      <h3 className="font-display text-2xl font-semibold mb-3 text-foreground">
        {title}
      </h3>
      <p className="text-muted-foreground leading-relaxed">
        {description}
      </p>
    </div>
  </div>
);

export default HowItWorksSection;
