const integrations = [
  { name: "Zoom", logo: "Z", color: "bg-blue-500" },
  { name: "Google Meet", logo: "G", color: "bg-green-500" },
  { name: "Microsoft Teams", logo: "T", color: "bg-purple-500" },
  { name: "Slack", logo: "S", color: "bg-pink-500" },
  { name: "Notion", logo: "N", color: "bg-foreground" },
  { name: "Salesforce", logo: "SF", color: "bg-blue-400" },
  { name: "HubSpot", logo: "H", color: "bg-orange" },
  { name: "Asana", logo: "A", color: "bg-red-500" },
];

const IntegrationsSection = () => {
  return (
    <section id="integrations" className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 starfield opacity-50" />
      
      <div className="container mx-auto px-4 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full bg-accent/10 text-accent text-sm font-medium mb-4">
            Integrations
          </span>
          <h2 className="font-display text-4xl md:text-5xl font-bold mb-6">
            Works with your
            <span className="text-gradient"> favorite tools</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Connect vribble.ai with the tools you already use. Sync meeting notes, action items, and insights automatically.
          </p>
        </div>

        {/* Integrations Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
          {integrations.map((integration, index) => (
            <IntegrationCard key={index} {...integration} />
          ))}
        </div>

        {/* CTA */}
        <div className="mt-16 text-center">
          <p className="text-muted-foreground mb-4">
            Don't see your tool? <span className="text-primary cursor-pointer hover:underline">Request an integration</span>
          </p>
        </div>
      </div>
    </section>
  );
};

const IntegrationCard = ({ 
  name, 
  logo, 
  color 
}: { 
  name: string; 
  logo: string; 
  color: string;
}) => (
  <div className="glass rounded-2xl p-6 text-center hover:border-primary/30 transition-all duration-300 hover:-translate-y-1 group cursor-pointer">
    <div className={`w-16 h-16 ${color} rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform shadow-lg`}>
      <span className="text-white font-bold text-xl">{logo}</span>
    </div>
    <p className="font-medium text-foreground">{name}</p>
  </div>
);

export default IntegrationsSection;
