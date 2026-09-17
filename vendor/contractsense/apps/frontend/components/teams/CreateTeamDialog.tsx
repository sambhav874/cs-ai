// components/teams/CreateTeamDialog.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiClient";

interface CreateTeamDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onTeamCreated: () => void;
}

export function CreateTeamDialog({ isOpen, setIsOpen, onTeamCreated }: CreateTeamDialogProps) {
  const [newTeamName, setNewTeamName] = useState("");
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const router = useRouter();

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) {
      toast({ 
        title: "Validation Error", 
        description: "Team name cannot be empty.", 
        variant: "destructive" 
      });
      return;
    }

    setIsCreatingTeam(true);
    
    try {
      const response = await apiFetch(`${process.env.NEXT_PUBLIC_EXTRACTOR_API_URL}/teams`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name: newTeamName.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Team creation failed with status:", response.status);
        if (response.status === 401 || response.status === 403) {
          router.push("/signin");
        }
        throw new Error(errorData.detail || `Failed to create team (${response.status})`);
      }

      const createdTeam = await response.json();
      
      toast({ 
        title: "Success!", 
        description: `Team "${createdTeam.name}" created successfully.` 
      });

      setNewTeamName("");
      setIsOpen(false);
      onTeamCreated();

    } catch (error: any) {
      console.error("Team creation error:", error);
      
      toast({
        title: "Team Creation Failed",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setIsCreatingTeam(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        setNewTeamName("");
        setIsCreatingTeam(false);
      }
      setIsOpen(open);
    }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Team</DialogTitle>
          <DialogDescription>
            Enter a name for your new team. You'll be the team admin.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="team-name" className="text-right">
              Team Name
            </Label>
            <Input
              id="team-name"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="e.g., Legal Team"
              className="col-span-3"
              disabled={isCreatingTeam}
              onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={isCreatingTeam}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={handleCreateTeam}
            disabled={isCreatingTeam || !newTeamName.trim()}
            className="bg-[#0084C7] hover:bg-[#0073b0]"
          >
            {isCreatingTeam ? (
              <>
                <svg className="mr-1 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating...
              </>
            ) : (
              "Create Team"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
