import Layout from "./Layout.jsx";

import Home from "./Home.jsx";

import Book from "./Book.jsx";

import Admin from "./Admin.jsx";

import MyAppointmentsPage from "./MyAppointmentsPage.jsx";
import Accessibility from "./Accessibility.jsx";

import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';

const PAGES = {
    
    Home: Home,
    
    Book: Book,
    
    Admin: Admin,
    
    MyAppointmentsPage: MyAppointmentsPage,
    Accessibility: Accessibility,
    
}

function _getCurrentPage(url) {
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    let urlLastPart = url.split('/').pop();
    if (urlLastPart.includes('?')) {
        urlLastPart = urlLastPart.split('?')[0];
    }

    const pageName = Object.keys(PAGES).find(page => page.toLowerCase() === urlLastPart.toLowerCase());
    return pageName || Object.keys(PAGES)[0];
}

// Create a wrapper component that uses useLocation inside the Router context
function PagesContent() {
    const location = useLocation();
    const currentPage = _getCurrentPage(location.pathname);
    

    useEffect(() => {
        const titleMap = {
            Home: 'בית',
            Book: 'קביעת תור',
            Admin: 'ניהול',
            MyAppointmentsPage: 'התורים שלי',
            Accessibility: 'הצהרת נגישות',
        };
        document.title = `${titleMap[currentPage] || 'Familia'} | Familia`;
        document.documentElement.lang = 'he';
        document.documentElement.dir = 'rtl';
    }, [currentPage]);
    return (
        <Layout currentPageName={currentPage}>
            <Routes>
                <Route index element={<Home />} />
                <Route path="/Home" element={<Home />} />
                
                <Route path="/Book" element={<Book />} />
                
                <Route path="/Admin" element={<Admin />} />
                
                <Route path="/MyAppointmentsPage" element={<MyAppointmentsPage />} />
                <Route path="/accessibility" element={<Accessibility />} />
                
            </Routes>
        </Layout>
    );
}

export default function Pages() {
    return (
        <Router>
            <PagesContent />
        </Router>
    );
}
