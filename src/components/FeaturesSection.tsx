import { Mail, Calendar, Video, Zap, Users, DollarSign } from "lucide-react";

const features = [
  {
    icon: Mail,
    title: "AI Follow-Up Emails",
    description: "Professional recap emails with action items, talking points, and decisions. Copy-paste ready in 30 seconds. This is our superpower.",
    color: "text-cyan",
    bgColor: "bg-cyan/10",
  },
  {
    icon: Calendar,
    title: "Personal + Group Scheduling",
    description: "Replace Calendly. Get yourname.vribble.com/book with calendar sync, custom booking pages, and group availability voting.",
    color: "text-magenta",
    bgColor: "bg-magenta/10",
  },
  {
    icon: Video,
    title: "Optional Video Recording",
    description: "You choose per meeting: Transcript-only (0.34 credits) or add video (1.0 credits). Important calls get video. Quick updates don't.",
    color: "text-purple",
    bgColor: "bg-purple/10",
  },
  {
    icon: Zap,
    title: "Full Integrations",
    description: "HubSpot, Salesforce, Slack, Gmail, Google Calendar, Outlook. Meetings become activities. Recaps go where you need them.",
    color: "text-orange",
    bgColor: "bg-orange/10",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description: "Shared credit pool. Admin dashboard. Shared meeting library. Team comments on transcripts. Everyone uses from one balance.",
    color: "text-cyan",
    bgColor: "bg-cyan/10",
  },
  {
    icon: DollarSign,
    title: "Transparent Pricing",
    description: "We show you our actual costs. Transcript: $0.18. Video: +$0.35. No 'unlimited' games. No hidden throttling. Just honest pricing.",
    color: "text-magenta",
    bgColor: "bg-magenta/10",
  },
];

const FeaturesSection = () => {
  return (
    <section id="features" className="py-24 relative">
      <div className="absolute inset-0 bg-gradient-glow opacity-20" />
      
      <div className="container mx-auto px-4 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            Features
          </span>
          <h2 className="font-display text-4xl md:text-5xl font-bold mb-6">
            Everything you need,
            <span className="text-gradient"> nothing you don't</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            AI emails. Scheduling. Recording. Integrations. Team collaboration. All included. No tiers. No upsells.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <FeatureCard key={index} {...feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
};

const FeatureCard = ({ 
  icon: Icon, 
  title, 
  description, 
  color, 
  bgColor,
  index 
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
  bgColor: string;
  index: number;
}) => (
  <div 
    className="group glass rounded-2xl p-8 hover:border-primary/30 transition-all duration-300 hover:-translate-y-1"
    style={{ animationDelay: `${index * 100}ms` }}
  >
    <div className={`w-14 h-14 rounded-xl ${bgColor} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
      <Icon className={`w-7 h-7 ${color}`} />
    </div>
    <h3 className="font-display text-xl font-semibold mb-3 text-foreground">
      {title}
    </h3>
    <p className="text-muted-foreground leading-relaxed">
      {description}
    </p>
  </div>
);

export default FeaturesSection;
