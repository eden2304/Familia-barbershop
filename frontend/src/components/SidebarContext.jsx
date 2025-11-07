import React, { createContext, useState, useContext } from 'react';

const SidebarContext = createContext(null);

export const SidebarProvider = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <SidebarContext.Provider value={{ sidebarOpen, setSidebarOpen }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const useSidebar = () => {
    const context = useContext(SidebarContext);
    if (context === null) {
        throw new Error("useSidebar must be used within a SidebarProvider");
    }
    return context;
};