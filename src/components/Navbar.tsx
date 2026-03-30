import { Button } from "@/components/ui/button";
import { Menu, X, LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { useToast } from "@/hooks/use-toast";

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user ?? null);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast({ title: "Logged out", description: "See you next time!" });
    navigate("/");
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      {/* Announcement Banner */}
      <div className="bg-gradient-banner py-2 px-4 text-center">
        <p className="text-sm font-medium text-primary-foreground">
          🚀 New: AI-powered action items extraction • 
          <span className="ml-2 underline cursor-pointer hover:no-underline">Learn more</span>
        </p>
      </div>
      
      {/* Main Nav */}
      <nav className="glass-strong">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-lg">V</span>
              </div>
              <span className="font-display font-bold text-xl text-foreground group-hover:text-primary transition-colors">
                vribble.ai
              </span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1">
              <nav className="glass rounded-full px-2 py-1">
                <ul className="flex items-center gap-1">
                  <li>
                    <a href="/#features" className="px-4 py-2 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all">
                      Features
                    </a>
                  </li>
                  <li>
                    <Link to="/pricing" className="px-4 py-2 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all">
                      Pricing
                    </Link>
                  </li>
                  <li>
                    <a href="/#how-it-works" className="px-4 py-2 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all">
                      How It Works
                    </a>
                  </li>
                </ul>
              </nav>
            </div>

            {/* CTA Buttons */}
            <div className="hidden md:flex items-center gap-3">
              {user ? (
                <>
                  <Link to="/dashboard">
                    <Button variant="ghost" size="default">
                      Dashboard
                    </Button>
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {user.email}
                  </span>
                  <Button variant="ghost" size="default" onClick={handleLogout}>
                    <LogOut className="w-4 h-4 mr-2" />
                    Logout
                  </Button>
                </>
              ) : (
                <>
                  <Link to="/auth">
                    <Button variant="hero" size="default">
                      Sign Up Free
                    </Button>
                  </Link>
                  <Link to="/auth">
                    <Button variant="ghost" size="default">
                      Login
                    </Button>
                  </Link>
                </>
              )}
            </div>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden p-2 rounded-lg hover:bg-secondary transition-colors"
              onClick={() => setIsOpen(!isOpen)}
            >
              {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {isOpen && (
          <div className="md:hidden glass-strong border-t border-border animate-slide-up">
            <div className="container mx-auto px-4 py-4 space-y-4">
              <a href="/#features" className="block py-2 text-muted-foreground hover:text-foreground transition-colors">
                Features
              </a>
              <Link to="/pricing" className="block py-2 text-muted-foreground hover:text-foreground transition-colors">
                Pricing
              </Link>
              <a href="/#how-it-works" className="block py-2 text-muted-foreground hover:text-foreground transition-colors">
                How It Works
              </a>
              <div className="flex flex-col gap-2 pt-4 border-t border-border">
                {user ? (
                  <>
                    <Link to="/dashboard">
                      <Button variant="ghost" className="w-full">Dashboard</Button>
                    </Link>
                    <span className="text-sm text-muted-foreground py-2">
                      {user.email}
                    </span>
                    <Button variant="ghost" className="w-full" onClick={handleLogout}>
                      <LogOut className="w-4 h-4 mr-2" />
                      Logout
                    </Button>
                  </>
                ) : (
                  <>
                    <Link to="/auth">
                      <Button variant="hero" className="w-full">Sign Up Free</Button>
                    </Link>
                    <Link to="/auth">
                      <Button variant="ghost" className="w-full">Login</Button>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
};

export default Navbar;
