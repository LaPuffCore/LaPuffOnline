import { useLocation, useNavigate } from 'react-router-dom';
// Fixed path: AuthContext is in the same folder (src/lib)
import { useAuth } from './AuthContext'; 

export default function PageNotFound() {
    const location = useLocation();
    const navigate = useNavigate();
    const { user } = useAuth(); 
    const pageName = location.pathname.substring(1);

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
            <div className="max-w-md w-full">
                <div className="text-center space-y-6">
                    <div className="space-y-2">
                        <h1 className="text-7xl font-light text-slate-300">404</h1>
                        <div className="h-0.5 w-16 bg-slate-200 mx-auto"></div>
                    </div>
                    
                    <div className="space-y-3">
                        <h2 className="text-2xl font-medium text-slate-800">
                            Page Not Found
                        </h2>
                        <p className="text-slate-600 leading-relaxed">
                            The page <span className="font-medium text-slate-700">"{pageName || 'this path'}"</span> does not exist.
                        </p>
                    </div>

                    {/* Developer context for your NYC creative/tech workspace */}
                    {user && (
                        <div className="mt-8 p-4 bg-amber-50 rounded-lg border border-amber-100 text-left">
                            <p className="text-sm font-medium text-amber-800">Dev Note</p>
                            <p className="text-sm text-amber-700">
                                Route <code>{location.pathname}</code> is not defined in <code>App.jsx</code>.
                            </p>
                        </div>
                    )}
                    
                    <div className="pt-6">
                        <button 
                            onClick={() => navigate('/')} 
                            className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
                        >
                            Go Home
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}