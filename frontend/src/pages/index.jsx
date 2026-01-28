import Layout from "./Layout.jsx";

import Home from "./Home.jsx";

import Book from "./Book.jsx";

import Admin from "./Admin.jsx";

import MyAppointmentsPage from "./MyAppointmentsPage.jsx";

import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';

const PAGES = {
    
    Home: Home,
    
    Book: Book,
    
    Admin: Admin,
    
    MyAppointmentsPage: MyAppointmentsPage,
    
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
    
    return (
        <Layout currentPageName={currentPage}>
            <Routes>
                <Route index element={<Home />} />
                <Route path="/Home" element={<Home />} />
                
                <Route path="/Book" element={<Book />} />
                
                <Route path="/Admin" element={<Admin />} />
                
                <Route path="/MyAppointmentsPage" element={<MyAppointmentsPage />} />
                
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
