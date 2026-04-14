#!/usr/bin/env python3
"""Run the avatar_emoji migration in Supabase"""

import os
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from api.utils import supabase

def run_migration():
    """Execute the avatar_emoji migration"""
    
    migration_file = Path(__file__).parent / 'backend' / 'supabase_migration_avatar_emoji.sql'
    
    if not migration_file.exists():
        print(f"❌ Migration file not found: {migration_file}")
        return False
    
    # Read the migration SQL
    with open(migration_file, 'r') as f:
        sql = f.read()
    
    print("📝 Running avatar_emoji migration...")
    print(f"SQL file: {migration_file}")
    
    try:
        # Execute the migration
        result = supabase.rpc('exec', {'query': sql}).execute()
        print("✅ Migration completed successfully!")
        return True
    except AttributeError:
        # supabase.rpc might not be available, try raw query instead
        print("⚠️  RPC method not available, using raw query...")
        try:
            # Try executing raw SQL via PostgreSQL
            from supabase import create_client
            import psycopg2
            
            # This would require direct database access
            print("❌ Direct SQL execution requires database credentials")
            print("Please run the migration in Supabase dashboard:")
            print()
            print(sql)
            return False
        except Exception as e:
            print(f"❌ Error: {e}")
            return False
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        print()
        print("Please run this SQL manually in Supabase dashboard:")
        print("-" * 60)
        print(sql)
        print("-" * 60)
        return False

if __name__ == "__main__":
    success = run_migration()
    sys.exit(0 if success else 1)
