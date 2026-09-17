// app/teams/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button"; // Keep for potential "Create Team" button
import Link from "next/link"; // For linking to team details page later
import LoadingScreen from "@/components/loader";
import { Users, Plus } from "lucide-react"; // Example icons
import { apiFetch } from "@/lib/apiClient";

//components
import { CreateTeamDialog } from "@/components/teams/CreateTeamDialog";

// Define an interface for the basic team info we expect from the API
interface TeamBasicInfo {
  id: string;
  name: string;
  // Add other fields if your API returns them and you want to display them
}

export default function TeamsPage() {
    const [teams, setTeams] = useState<TeamBasicInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const router = useRouter();
  
    const fetchTeams = async () => {
      setIsLoading(true);
      setError(null);
      const apiUrl = `${process.env.NEXT_PUBLIC_EXTRACTOR_API_URL}/teams`;
  
      try {
        // --- Use the apiUrl variable in the fetch call ---
        const response = await apiFetch(apiUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });
        // --- End fetch call ---
  
        if (!response.ok) {
          // Log the status for debugging 404s
          console.error(`Fetch failed with status: ${response.status} ${response.statusText}`);
          if (response.status === 401 || response.status === 403) {
            throw new Error("Unauthorized. Please sign in again.");
          }
          // More specific message for 404
          if (response.status === 404) {
               throw new Error(`API endpoint not found at ${apiUrl} (status: 404)`);
          }
          throw new Error(`Failed to fetch teams (status: ${response.status})`);
        }
  
        const data: TeamBasicInfo[] = await response.json();
        setTeams(data);
  
      } catch (err: any) {
        console.error("Error fetching teams:", err);
        setError(err.message || "An unexpected error occurred.");
        toast({
          title: "Error",
          description: err.message || "Could not fetch teams.",
          variant: "destructive",
        });
        if (err.message?.includes("Unauthorized")) {
          router.push("/signin");
        }
      } finally {
        setIsLoading(false);
      }
    };
  
    useEffect(() => {
      fetchTeams();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleTeamCreated = () => {
      fetchTeams();
  }

  return (
    <div className="min-h-screen bg-white pt-20 font-InterVar text-gray-900">
      <main>
        <div className="flex flex-col gap-4 border-b border-gray-200 px-4 py-5 md:flex-row md:items-center md:justify-between md:px-10">
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-gray-700" />
            <div>
              <h1 className="font-serif text-3xl font-light text-gray-900">Teams</h1>
              <p className="mt-1 text-sm text-gray-500">Create and manage account workspaces.</p>
            </div>
          </div>
          <Button
             onClick={() => setIsCreateDialogOpen(true)}
             className="h-9 gap-2 bg-gray-900 text-white hover:bg-cs-primary/90"
             size="sm"
           >
             <Plus className="h-4 w-4" />
             Create Team
           </Button>
        </div>

         {/* Render the Dialog Component */}
         <CreateTeamDialog
          isOpen={isCreateDialogOpen}
          setIsOpen={setIsCreateDialogOpen}
          onTeamCreated={handleTeamCreated} // Pass the callback
        />


        <div className="px-4 py-6 md:px-10">
        {isLoading ? (
          <div className="relative min-h-[50vh] flex items-center justify-center">
            <LoadingScreen /> {/* Use your existing loading component */}
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-center text-red-700">
            <p>Error loading teams: {error}</p>
            <Button onClick={fetchTeams} variant="outline" size="sm" className="mt-2">
              Retry
            </Button>
          </div>
        ) : teams.length === 0 ? (
           <div className="rounded-md border border-gray-200 bg-white px-6 py-10 text-center text-gray-500">
             <Users size={48} className="mx-auto text-gray-400 mb-4" />
             <h3 className="text-xl font-semibold mb-2">No Teams Yet</h3>
             <p className="mb-4">You haven't created or joined any teams.</p>
           </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <Link href={`/teams/${team.id}`} key={team.id} legacyBehavior>
                <a className="block rounded-md border border-gray-200 bg-white p-5 transition-colors hover:bg-gray-50 group">
                  <h2 className="text-sm font-semibold text-gray-900 transition-colors">
                    {team.name}
                  </h2>
                  <p className="text-sm text-gray-500 mt-2">ID: {team.id}</p> {/* Display ID for now */}
                </a>
              </Link>
            ))}
          </div>
        )}
        </div>
      </main>
    </div>
  );
}
